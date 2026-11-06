package model

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/alicebob/miniredis/v2"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// Production uses a single-endpoint client. Connect it to the actual slot
// owner to exercise its Lua and MGET operations on a six-node Redis Cluster;
// this does not imply native cluster discovery/routing support in the gateway.
func TestAuthCacheRealRedisCluster(t *testing.T) {
	addresses := os.Getenv("TEST_AUTH_REDIS_CLUSTER_ADDRS")
	if addresses == "" {
		t.Skip("TEST_AUTH_REDIS_CLUSTER_ADDRS is not configured")
	}
	cluster := redis.NewClient(&redis.Options{Addr: strings.Split(addresses, ",")[0]})
	t.Cleanup(func() { assert.NoError(t, cluster.Close()) })
	// Redis 7 adds optional node metadata to CLUSTER SLOTS. go-redis/v8's
	// ClusterSlots parser rejects that fourth element; inspect the protocol
	// response without changing the production client or dependency set.
	raw, err := cluster.Do(t.Context(), "CLUSTER", "SLOTS").Result()
	require.NoError(t, err)
	require.IsType(t, []any{}, raw)
	var slots []redis.ClusterSlot
	for _, entry := range raw.([]any) {
		require.IsType(t, []any{}, entry)
		fields := entry.([]any)
		require.GreaterOrEqual(t, len(fields), 3)
		require.IsType(t, int64(0), fields[0])
		require.IsType(t, int64(0), fields[1])
		slot := redis.ClusterSlot{Start: int(fields[0].(int64)), End: int(fields[1].(int64))}
		for _, value := range fields[2:] {
			require.IsType(t, []any{}, value)
			node := value.([]any)
			require.GreaterOrEqual(t, len(node), 3)
			slot.Nodes = append(slot.Nodes, redis.ClusterNode{ID: fmt.Sprint(node[2]), Addr: fmt.Sprintf("%v:%v", node[0], node[1])})
		}
		slots = append(slots, slot)
	}
	masters, nodes := map[string]bool{}, map[string]bool{}
	for _, slot := range slots {
		require.NotEmpty(t, slot.Nodes)
		masters[slot.Nodes[0].ID] = true
		for _, node := range slot.Nodes {
			nodes[node.ID] = true
		}
	}
	require.GreaterOrEqual(t, len(masters), 3, "A single-node cluster cannot verify this regression")
	require.GreaterOrEqual(t, len(nodes), 6, "Expected three masters and three replicas")
	t.Logf("Real Redis Cluster: %d masters, %d nodes, %d slot ranges", len(masters), len(nodes), len(slots))
	oldRDB, oldEnabled, oldSecret := common.RDB, common.RedisEnabled, common.CryptoSecret
	common.RedisEnabled, common.CryptoSecret = true, "disposable-cluster-regression-only"
	t.Cleanup(func() { common.RDB, common.RedisEnabled, common.CryptoSecret = oldRDB, oldEnabled, oldSecret })

	for _, family := range []string{"user", "token"} {
		t.Run(family, func(t *testing.T) {
			const userID = 42076001
			const tokenKey = "disposable-cluster-regression-token"
			keys := []string{getUserCacheKey(userID), getUserAuthFenceKey(userID), getUserAuthVersionKey(userID)}
			oldFence := fmt.Sprintf("auth:user:fence:%d", userID)
			if family == "token" {
				keys = []string{getTokenCacheKey(tokenKey), getTokenCacheFenceKey(tokenKey)}
				oldFence = "token:fence:" + common.GenerateHMAC(tokenKey)
			}
			slot, err := cluster.ClusterKeySlot(t.Context(), keys[0]).Result()
			require.NoError(t, err)
			var address string
			for _, entry := range slots {
				if slot >= int64(entry.Start) && slot <= int64(entry.End) {
					address = entry.Nodes[0].Addr
					break
				}
			}
			require.NotEmpty(t, address)
			client := redis.NewClient(&redis.Options{Addr: address})
			common.RDB = client
			t.Cleanup(func() {
				for _, key := range keys {
					assert.NoError(t, client.Del(context.Background(), key).Err())
				}
				assert.NoError(t, client.Close())
			})
			for _, key := range keys {
				actual, err := cluster.ClusterKeySlot(t.Context(), key).Result()
				require.NoError(t, err)
				assert.Equal(t, slot, actual)
				require.NoError(t, client.Del(t.Context(), key).Err())
			}
			err = client.MGet(t.Context(), keys[0], oldFence).Err()
			require.ErrorContains(t, err, "CROSSSLOT", "Legacy key layout must reproduce the actual cluster failure")
			t.Logf("%s production operations use slot %d on %s; legacy layout returns CROSSSLOT", family, slot, address)
			if family == "user" {
				user := &UserBase{Id: userID, Username: "cluster-user", Group: "default", AuthVersion: 1, Status: common.UserStatusEnabled, Role: common.RoleCommonUser}
				require.NoError(t, writeUserCache(user, true))
				cached, err := cacheGetUserBase(userID)
				require.NoError(t, err)
				assert.EqualValues(t, 1, cached.AuthVersion)
				require.NoError(t, SetUserAuthVersionFence(userID, 2))
				floor, err := getUserAuthVersionFloor(userID)
				require.NoError(t, err)
				assert.EqualValues(t, 2, floor)
				assert.ErrorIs(t, writeUserCache(user, true), ErrUserAuthCachePending)
				require.NoError(t, publishCommittedUserAuthVersion(userID, 2))
				assert.ErrorIs(t, writeUserCache(user, true), ErrUserAuthCachePending)
				user.AuthVersion = 2
				require.NoError(t, writeUserCache(user, true))
				cached, err = cacheGetUserBase(userID)
				require.NoError(t, err)
				assert.EqualValues(t, 2, cached.AuthVersion)
			} else {
				token := Token{Id: 42076002, UserId: userID, Key: tokenKey, Name: "cluster-token", Status: common.TokenStatusEnabled, RemainQuota: 100, Group: "default"}
				result, err := cacheInitToken(token)
				require.NoError(t, err)
				assert.Equal(t, 1, result)
				cached, err := cacheGetTokenByKey(tokenKey)
				require.NoError(t, err)
				assert.Equal(t, token.Id, cached.Id)
				require.NoError(t, invalidateTokenCacheForMutation(tokenKey))
				_, err = cacheGetTokenByKey(tokenKey)
				assert.Error(t, err)
				result, err = cacheInitToken(token)
				require.NoError(t, err)
				assert.Zero(t, result, "Fenced metadata must not repopulate the cache")
			}
		})
	}
}

// Sharded Redis hashes only the text inside the first brace pair, so fence
// and version keys tagged with the untagged cache key share its slot.
// Miniredis does not enforce slots, so check the tags explicitly.
func TestAuthCacheKeysShareClusterHashTag(t *testing.T) {
	for _, tc := range []struct {
		cacheKey string
		related  []string
	}{
		{getUserCacheKey(5), []string{getUserAuthFenceKey(5), getUserAuthVersionKey(5)}},
		{getTokenCacheKey("test-token"), []string{getTokenCacheFenceKey("test-token")}},
	} {
		assert.NotContains(t, tc.cacheKey, "{")
		for _, key := range tc.related {
			_, suffix, ok := strings.Cut(key, "{")
			require.True(t, ok)
			tag, _, ok := strings.Cut(suffix, "}")
			require.True(t, ok)
			assert.Equal(t, tc.cacheKey, tag)
		}
	}
}

func useUserCacheMiniRedis(t *testing.T) *miniredis.Miniredis {
	t.Helper()
	server := miniredis.RunT(t)
	oldRedisEnabled := common.RedisEnabled
	oldRDB := common.RDB
	oldSyncFrequency := common.SyncFrequency
	common.RedisEnabled = true
	common.SyncFrequency = 2
	common.RDB = redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() {
		_ = common.RDB.Close()
		common.RedisEnabled = oldRedisEnabled
		common.RDB = oldRDB
		common.SyncFrequency = oldSyncFrequency
	})
	return server
}

func TestUserAuthFenceRollbackExpiresAndRecovers(t *testing.T) {
	truncateTables(t)
	server := useUserCacheMiniRedis(t)

	user := User{
		Username:    "auth-fence-rollback",
		Password:    "password",
		Role:        common.RoleCommonUser,
		Status:      common.UserStatusEnabled,
		Group:       "default",
		AuthVersion: 1,
	}
	require.NoError(t, DB.Create(&user).Error)
	require.NoError(t, populateUserCache(user))

	tx := DB.Begin()
	require.NoError(t, tx.Error)
	next, err := IncrementUserAuthVersionWithTx(tx, user.Id)
	require.NoError(t, err)
	assert.EqualValues(t, 2, next)

	_, err = cacheGetUserBase(user.Id)
	assert.ErrorIs(t, err, ErrUserAuthCachePending)
	cacheTTL, err := common.RDB.TTL(t.Context(), getUserCacheKey(user.Id)).Result()
	require.NoError(t, err)
	fenceTTL, err := common.RDB.TTL(t.Context(), getUserAuthFenceKey(user.Id)).Result()
	require.NoError(t, err)
	assert.Greater(t, fenceTTL, cacheTTL)
	require.NoError(t, tx.Rollback().Error)

	server.FastForward(time.Duration(userAuthFenceTTLSeconds()+1) * time.Second)
	assert.False(t, server.Exists(getUserAuthFenceKey(user.Id)))
	committed, err := common.RDB.Get(t.Context(), getUserAuthVersionKey(user.Id)).Result()
	require.NoError(t, err)
	assert.Equal(t, "1", committed)

	cached, err := GetUserCache(user.Id)
	require.NoError(t, err)
	assert.EqualValues(t, 1, cached.AuthVersion)
}

func TestPendingUserAuthFenceRejectsStaleCacheWrite(t *testing.T) {
	server := useUserCacheMiniRedis(t)
	const userID = 4201
	require.NoError(t, SetUserAuthVersionFence(userID, 2))

	err := writeUserCache(&UserBase{
		Id: userID, Group: "default", Username: "stale", AuthVersion: 1,
	}, true)

	assert.ErrorIs(t, err, ErrUserAuthCachePending)
	assert.False(t, server.Exists(getUserCacheKey(userID)))
}

func TestUserAuthCacheUpdateRejectsVersionMismatch(t *testing.T) {
	useUserCacheMiniRedis(t)
	const userID = 4202
	require.NoError(t, writeUserCache(&UserBase{
		Id: userID, Group: "current", Username: "cached", AuthVersion: 3,
	}, true))

	err := writeUserCache(&UserBase{Id: userID, Group: "stale", AuthVersion: 2}, false)

	assert.ErrorIs(t, err, ErrUserAuthCachePending)
	group, err := common.RDB.HGet(t.Context(), getUserCacheKey(userID), "Group").Result()
	require.NoError(t, err)
	assert.Equal(t, "current", group)
}

func TestRefreshUserGroupCacheRepairsDelayedSameVersionWrite(t *testing.T) {
	truncateTables(t)
	useUserCacheMiniRedis(t)

	user := User{
		Username:    "delayed-group-refresh",
		Password:    "password",
		Role:        common.RoleCommonUser,
		Status:      common.UserStatusEnabled,
		Group:       "default",
		AuthVersion: 1,
	}
	require.NoError(t, DB.Create(&user).Error)
	require.NoError(t, populateUserCache(user))

	firstSnapshotRead := make(chan struct{})
	releaseDelayedRefresh := make(chan struct{})
	var intercepted atomic.Bool
	const callbackName = "test:block_delayed_group_refresh"
	require.NoError(t, DB.Callback().Query().After("gorm:query").Register(callbackName, func(*gorm.DB) {
		if intercepted.CompareAndSwap(false, true) {
			close(firstSnapshotRead)
			<-releaseDelayedRefresh
		}
	}))
	t.Cleanup(func() {
		_ = DB.Callback().Query().Remove(callbackName)
	})

	delayedResult := make(chan error, 1)
	go func() {
		delayedResult <- RefreshUserGroupCache(user.Id)
	}()
	<-firstSnapshotRead

	require.NoError(t, DB.Model(&User{}).Where("id = ?", user.Id).Update("group", "pro").Error)
	require.NoError(t, RefreshUserGroupCache(user.Id))
	cached, err := cacheGetUserBase(user.Id)
	require.NoError(t, err)
	assert.Equal(t, "pro", cached.Group)
	assert.EqualValues(t, 1, cached.AuthVersion)

	close(releaseDelayedRefresh)
	require.NoError(t, <-delayedResult)
	cached, err = cacheGetUserBase(user.Id)
	require.NoError(t, err)
	assert.Equal(t, "pro", cached.Group)
	assert.EqualValues(t, 1, cached.AuthVersion)
}

func TestCommittedUserAuthVersionPermanentlyRejectsDelayedCacheFill(t *testing.T) {
	truncateTables(t)
	server := useUserCacheMiniRedis(t)

	user := User{
		Username:    "auth-fence-commit",
		Password:    "password",
		Role:        common.RoleCommonUser,
		Status:      common.UserStatusEnabled,
		Group:       "default",
		AuthVersion: 1,
	}
	require.NoError(t, DB.Create(&user).Error)
	require.NoError(t, populateUserCache(user))
	stale := *user.ToBaseUser()

	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		_, err := IncrementUserAuthVersionWithTx(tx, user.Id)
		return err
	}))
	require.NoError(t, PublishUserAuthCache(user.Id))
	assert.False(t, server.Exists(getUserAuthFenceKey(user.Id)))
	committed, err := common.RDB.Get(t.Context(), getUserAuthVersionKey(user.Id)).Result()
	require.NoError(t, err)
	assert.Equal(t, "2", committed)

	server.FastForward(time.Duration(userAuthFenceTTLSeconds()+1) * time.Second)
	require.NoError(t, common.RedisDelKey(getUserCacheKey(user.Id)))
	err = writeUserCache(&stale, true)
	assert.True(t, errors.Is(err, ErrUserAuthCachePending))
	committed, err = common.RDB.Get(t.Context(), getUserAuthVersionKey(user.Id)).Result()
	require.NoError(t, err)
	assert.Equal(t, "2", committed)
}

func TestUserAuthVersionFenceAndCommittedFloorAreMonotonic(t *testing.T) {
	truncateTables(t)
	server := useUserCacheMiniRedis(t)

	const userID = 4101
	require.NoError(t, SetUserAuthVersionFence(userID, 5))
	require.NoError(t, SetUserAuthVersionFence(userID, 3))
	pending, err := common.RDB.Get(t.Context(), getUserAuthFenceKey(userID)).Result()
	require.NoError(t, err)
	assert.Equal(t, "5", pending)
	floor, err := getUserAuthVersionFloor(userID)
	require.NoError(t, err)
	assert.EqualValues(t, 5, floor)

	// Committing an older transaction must neither clear a newer pending fence
	// nor lower the effective deny floor.
	require.NoError(t, publishCommittedUserAuthVersion(userID, 3))
	pending, err = common.RDB.Get(t.Context(), getUserAuthFenceKey(userID)).Result()
	require.NoError(t, err)
	assert.Equal(t, "5", pending)
	floor, err = getUserAuthVersionFloor(userID)
	require.NoError(t, err)
	assert.EqualValues(t, 5, floor)

	require.NoError(t, publishCommittedUserAuthVersion(userID, 5))
	assert.False(t, server.Exists(getUserAuthFenceKey(userID)))
	committed, err := common.RDB.Get(t.Context(), getUserAuthVersionKey(userID)).Result()
	require.NoError(t, err)
	assert.Equal(t, "5", committed)

	require.NoError(t, publishCommittedUserAuthVersion(userID, 4))
	committed, err = common.RDB.Get(t.Context(), getUserAuthVersionKey(userID)).Result()
	require.NoError(t, err)
	assert.Equal(t, "5", committed)
}
