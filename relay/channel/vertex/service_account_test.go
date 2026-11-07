package vertex

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// stubAccessTokenFetch replaces the Google token exchange for one test and
// clears the token cache before and after it.
func stubAccessTokenFetch(t *testing.T, fetch func(Credentials, string) (string, time.Duration, error)) {
	t.Helper()
	accessTokens.Clear()
	original := fetchAccessToken
	fetchAccessToken = fetch
	t.Cleanup(func() {
		fetchAccessToken = original
		accessTokens.Clear()
	})
}

func newAccessTokenTestInfo(channelID int) *relaycommon.RelayInfo {
	return &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelId: channelID}}
}

func newAccessTokenTestAdaptor(keyID string) *Adaptor {
	return &Adaptor{AccountCredentials: Credentials{ClientEmail: "sa@project.iam.gserviceaccount.com", PrivateKeyID: keyID}}
}

func TestGetAccessTokenReusesTokenUntilNearExpiry(t *testing.T) {
	var calls atomic.Int32
	stubAccessTokenFetch(t, func(Credentials, string) (string, time.Duration, error) {
		return fmt.Sprintf("token-%d", calls.Add(1)), time.Hour, nil
	})
	info := newAccessTokenTestInfo(7)
	a := newAccessTokenTestAdaptor("key-1")

	first, err := getAccessToken(a, info)
	require.NoError(t, err)
	second, err := getAccessToken(a, info)
	require.NoError(t, err)
	assert.Equal(t, "token-1", first)
	assert.Equal(t, first, second)
	assert.Equal(t, int32(1), calls.Load())

	// A token inside the refresh margin is replaced.
	value, ok := accessTokens.Load("7")
	require.True(t, ok)
	entry := value.(cachedAccessToken)
	entry.expiresAt = time.Now().Add(-time.Second)
	accessTokens.Store("7", entry)

	third, err := getAccessToken(a, info)
	require.NoError(t, err)
	assert.Equal(t, "token-2", third)
	assert.Equal(t, int32(2), calls.Load())
}

func TestGetAccessTokenSeparatesKeySlotsAndReplacedKeys(t *testing.T) {
	var calls atomic.Int32
	stubAccessTokenFetch(t, func(creds Credentials, _ string) (string, time.Duration, error) {
		calls.Add(1)
		return creds.PrivateKeyID, time.Hour, nil
	})

	multiKey := newAccessTokenTestInfo(9)
	multiKey.ChannelIsMultiKey = true
	multiKey.ChannelMultiKeyIndex = 1
	slotOne, err := getAccessToken(newAccessTokenTestAdaptor("slot-1"), multiKey)
	require.NoError(t, err)
	multiKey.ChannelMultiKeyIndex = 2
	slotTwo, err := getAccessToken(newAccessTokenTestAdaptor("slot-2"), multiKey)
	require.NoError(t, err)
	assert.Equal(t, "slot-1", slotOne)
	assert.Equal(t, "slot-2", slotTwo)

	// Replacing the channel's key fetches a token for the new key.
	single := newAccessTokenTestInfo(10)
	_, err = getAccessToken(newAccessTokenTestAdaptor("old"), single)
	require.NoError(t, err)
	replaced, err := getAccessToken(newAccessTokenTestAdaptor("new"), single)
	require.NoError(t, err)
	assert.Equal(t, "new", replaced)
	assert.Equal(t, int32(4), calls.Load())
}

func TestGetAccessTokenSharesOneExchangeAcrossConcurrentRequests(t *testing.T) {
	var calls atomic.Int32
	release := make(chan struct{})
	started := make(chan struct{}, 1)
	stubAccessTokenFetch(t, func(Credentials, string) (string, time.Duration, error) {
		calls.Add(1)
		started <- struct{}{}
		<-release
		return "shared", time.Hour, nil
	})
	info := newAccessTokenTestInfo(11)
	a := newAccessTokenTestAdaptor("key-1")

	const workers = 8
	var wg sync.WaitGroup
	results := make([]string, workers)
	for i := range workers {
		wg.Go(func() {
			results[i], _ = getAccessToken(a, info)
		})
	}
	<-started
	close(release)
	wg.Wait()

	assert.Equal(t, int32(1), calls.Load())
	for _, token := range results {
		assert.Equal(t, "shared", token)
	}
}

func TestGetAccessTokenDoesNotCacheFailures(t *testing.T) {
	var calls atomic.Int32
	stubAccessTokenFetch(t, func(Credentials, string) (string, time.Duration, error) {
		if calls.Add(1) == 1 {
			return "", 0, errors.New("exchange failed")
		}
		return "recovered", time.Hour, nil
	})
	info := newAccessTokenTestInfo(12)
	a := newAccessTokenTestAdaptor("key-1")

	_, err := getAccessToken(a, info)
	require.ErrorContains(t, err, "exchange failed")
	token, err := getAccessToken(a, info)
	require.NoError(t, err)
	assert.Equal(t, "recovered", token)
}

func TestGetAccessTokenRotatedPrivateKeyWithUnchangedID(t *testing.T) {
	var calls atomic.Int32
	stubAccessTokenFetch(t, func(creds Credentials, _ string) (string, time.Duration, error) {
		calls.Add(1)
		return "token-for-" + creds.PrivateKey, time.Hour, nil
	})
	info := newAccessTokenTestInfo(13)
	a := newAccessTokenTestAdaptor("")
	a.AccountCredentials.PrivateKey = "old-private-material"
	first, err := getAccessToken(a, info)
	require.NoError(t, err)
	a.AccountCredentials.PrivateKey = "replacement-private-material"
	second, err := getAccessToken(a, info)
	require.NoError(t, err)
	assert.NotEqual(t, first, second)
	assert.Equal(t, int32(2), calls.Load())
}

func TestGetAccessTokenDoesNotCacheShortLivedTokens(t *testing.T) {
	var calls atomic.Int32
	stubAccessTokenFetch(t, func(Credentials, string) (string, time.Duration, error) {
		calls.Add(1)
		return "short-lived", accessTokenRefreshMargin, nil
	})
	for range 2 {
		token, err := getAccessToken(newAccessTokenTestAdaptor("short"), newAccessTokenTestInfo(14))
		require.NoError(t, err)
		assert.Equal(t, "short-lived", token)
	}
	assert.Equal(t, int32(2), calls.Load())
}

type tokenExchangeTransport func(*http.Request) (*http.Response, error)

func (f tokenExchangeTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestExchangeJwtValidatesTokenResponseWithoutLeakingSecrets(t *testing.T) {
	client, err := service.GetHttpClientWithProxy("")
	require.NoError(t, err)
	original := client.Transport
	t.Cleanup(func() { client.Transport = original })
	for _, tc := range []struct {
		name      string
		status    int
		body      string
		lifetime  time.Duration
		wantError bool
	}{
		{name: "valid lifetime", status: 200, body: `{"access_token":"token","expires_in":3600}`, lifetime: time.Hour},
		{name: "short lifetime", status: 200, body: `{"access_token":"token","expires_in":60}`, lifetime: time.Minute},
		{name: "missing expiry keeps compatibility", status: 200, body: `{"access_token":"token"}`, lifetime: time.Hour},
		{name: "zero expiry", status: 200, body: `{"access_token":"token","expires_in":0}`, wantError: true},
		{name: "negative expiry", status: 200, body: `{"access_token":"token","expires_in":-1}`, wantError: true},
		{name: "fractional expiry", status: 200, body: `{"access_token":"token","expires_in":1.5}`, wantError: true},
		{name: "overflow expiry", status: 200, body: `{"access_token":"token","expires_in":1e30}`, wantError: true},
		{name: "wrong expiry type", status: 200, body: `{"access_token":"token","expires_in":"3600"}`, wantError: true},
		{name: "null expiry", status: 200, body: `{"access_token":"token","expires_in":null}`, wantError: true},
		{name: "empty token", status: 200, body: `{"access_token":"  ","expires_in":3600}`, wantError: true},
		{name: "missing token", status: 200, body: `{"error_description":"secret-marker"}`, wantError: true},
		{name: "failure status with token", status: 401, body: `{"access_token":"secret-marker","expires_in":3600}`, wantError: true},
		{name: "malformed response", status: 200, body: `secret-marker`, wantError: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client.Transport = tokenExchangeTransport(func(req *http.Request) (*http.Response, error) {
				assert.Equal(t, "https://www.googleapis.com/oauth2/v4/token", req.URL.String())
				require.NoError(t, req.ParseForm())
				assert.Equal(t, "signed-jwt", req.Form.Get("assertion"))
				return &http.Response{StatusCode: tc.status, Body: io.NopCloser(strings.NewReader(tc.body)), Header: make(http.Header)}, nil
			})
			token, lifetime, err := exchangeJwtForAccessToken("signed-jwt", "")
			if tc.wantError {
				require.Error(t, err)
				assert.NotContains(t, err.Error(), "secret-marker")
				assert.Empty(t, token)
				assert.Zero(t, lifetime)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, "token", token)
			assert.Equal(t, tc.lifetime, lifetime)
		})
	}
}
