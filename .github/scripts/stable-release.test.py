"""Regression checks for registry promotion and digest-pinned deployment."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("promotion", Path(__file__).with_name("promote-stable.py"))
promotion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(promotion)
SHA = "a" * 40
DIGEST = "sha256:" + "b" * 64
ENV = {
    "GITHUB_REPOSITORY": "ludafenqi/wuchuang-api", "GITHUB_REF": "refs/heads/main",
    "GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_SHA": SHA, "GITHUB_RUN_ID": "123",
    "DIGEST": DIGEST,
}


class PromotionTests(unittest.TestCase):
    def test_main_and_latest_run_are_required(self):
        cases = [
            ({}, SHA, 123, True),
            ({"GITHUB_REF": "refs/heads/test"}, SHA, 123, False),
            ({"GITHUB_REPOSITORY": "someone/fork"}, SHA, 123, False),
            ({"GITHUB_EVENT_NAME": "push"}, SHA, 123, False),
            ({}, "c" * 40, 123, False),
            ({}, SHA, 124, False),
        ]
        for override, main, latest, allowed in cases:
            with self.subTest(override=override, main=main, latest=latest):
                with patch.dict(os.environ, {**ENV, **override}), patch.object(
                    promotion, "command",
                    side_effect=[f"{main}\trefs/heads/main\n".encode(),
                                 json.dumps({"workflow_runs": [{"id": latest}]}).encode()],
                ):
                    if allowed:
                        promotion.require_current_release()
                    else:
                        with self.assertRaises(RuntimeError):
                            promotion.require_current_release()

    def test_registry_rejects_digest_mismatch(self):
        with patch.object(promotion, "command", return_value=b'{"manifests":[]}'):
            with self.assertRaisesRegex(RuntimeError, "differs"):
                promotion.registry_index("test", DIGEST)

    def test_only_verified_current_image_is_promoted(self):
        index = {"manifests": [
            {"digest": "platform", "platform": {"architecture": "amd64", "os": "linux"}},
            {"annotations": {"vnd.docker.reference.digest": "platform",
                             "vnd.docker.reference.type": "attestation-manifest"}},
        ]}
        for failure in ("", "runtime", "main moved", "wrong stable", "missing provenance"):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as folder:
                with patch.dict(os.environ, {**ENV, "RUNNER_TEMP": folder, "GITHUB_STEP_SUMMARY": folder + "/summary"}), patch.object(
                    promotion, "require_current_release",
                    side_effect=[None, RuntimeError("main moved")] if failure == "main moved" else None,
                ), patch.object(
                    promotion, "registry_index",
                    side_effect=[index, index, {"manifests": []}] if failure == "wrong stable" else None,
                    return_value={"manifests": []} if failure == "missing provenance" else index,
                ), patch.object(
                    promotion, "verify_runtime", return_value={"platform": "linux/amd64"},
                    side_effect=RuntimeError("runtime") if failure == "runtime" else None,
                ), patch.object(promotion, "command") as mutation:
                    if failure:
                        with self.assertRaises(RuntimeError):
                            promotion.promote()
                        self.assertFalse((Path(folder) / "stable-release/release.json").exists())
                        if failure != "wrong stable":
                            mutation.assert_not_called()
                    else:
                        promotion.promote()
                        mutation.assert_called_once_with(
                            "docker", "buildx", "imagetools", "create", "--tag",
                            promotion.IMAGE + ":stable", promotion.IMAGE + "@" + DIGEST,
                        )
                        evidence = json.loads((Path(folder) / "stable-release/release.json").read_text())
                        self.assertEqual(evidence["digest"], DIGEST)
                        self.assertEqual(evidence["sourceRevision"], SHA)

    def test_runtime_failure_always_cleans_up(self):
        image = [{"Os": "linux", "Architecture": "amd64", "Id": "image", "Config": {"Labels": {
            "org.opencontainers.image.revision": SHA,
            "org.opencontainers.image.source": "https://github.com/ludafenqi/wuchuang-api",
        }}}]
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, ENV), patch.object(
            promotion, "command", side_effect=[b"", json.dumps(image).encode(), RuntimeError("start failed"), b""],
        ) as calls:
            with self.assertRaisesRegex(RuntimeError, "start failed"):
                promotion.verify_runtime("pinned", SHA, Path(folder))
            self.assertEqual(calls.call_args.args, ("docker", "rm", "-f", "wucora-stable-123"))


@unittest.skipIf(os.name == "nt", "Bash deployment integration runs on Linux CI")
class DeploymentTests(unittest.TestCase):
    def test_deploy_resolves_once_and_persists_digest(self):
        for reference in (promotion.IMAGE + ":stable", promotion.IMAGE + ":sha-" + SHA, promotion.IMAGE + "@" + DIGEST):
            with self.subTest(reference=reference):
                self.run_deploy(reference)

    def test_failed_resolution_preserves_release_state(self):
        self.run_deploy(promotion.IMAGE + ":stable", failure="resolve")

    def test_invalid_tag_is_rejected(self):
        self.run_deploy(promotion.IMAGE + ":sha-short", failure="invalid")

    def test_health_or_image_mismatch_rolls_back_to_local_image(self):
        for failure in ("health", "image"):
            with self.subTest(failure=failure):
                self.run_deploy(promotion.IMAGE + ":stable", failure=failure)

    def run_deploy(self, reference, failure=""):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            (base / "bin").mkdir()
            state = base / ".wuchuang-release"
            state.mkdir()
            (state / "current-image.txt").write_text("previous")
            (base / "compose.yml").write_text("services: {}\n")
            docker = """#!/usr/bin/env python3
import json, os, sys
a = sys.argv[1:]
with open(os.environ["COMMAND_LOG"], "a") as f:
    f.write(json.dumps([a, os.environ.get("WUCHUANG_IMAGE")]) + "\\n")
if a[:3] == ["buildx", "imagetools", "inspect"]:
    if os.environ.get("FAILURE") == "resolve": sys.exit(1)
    print(os.environ["EXPECTED_DIGEST"])
elif a[:2] == ["image", "inspect"]: print("new-image")
elif a[0] == "inspect":
    if ".State.Running" in a[2]: print("true")
    elif a[-1] == "old-container": print("old-image")
    else: print("wrong-image" if os.environ.get("FAILURE") == "image" else "new-image")
elif a[0] == "compose":
    if "--services" in a: print("new-api")
    elif "ps" in a: print("new-container" if a.count("-f") == 2 else "old-container")
"""
            curl = """#!/usr/bin/env python3
import os, sys
if os.environ.get("FAILURE") == "health": sys.exit(1)
print('{"success":true}')
"""
            for name, source in (("docker", docker), ("curl", curl), ("sleep", "#!/bin/sh\nexit 0\n")):
                file = base / "bin" / name
                file.write_text(source)
                file.chmod(0o755)
            env = {**os.environ,
                "PATH": str(base / "bin") + os.pathsep + os.environ["PATH"],
                "BASE_DIR": folder, "BACKUP_CONFIRMED": "YES", "COMMAND_LOG": folder + "/commands",
                "EXPECTED_DIGEST": DIGEST, "FAILURE": failure,
            }
            script = ROOT / "scripts/wuchuang-deploy.sh"
            subprocess.run(["bash", "-n", str(script)], check=True)
            result = subprocess.run(["bash", str(script), "deploy", reference], env=env, capture_output=True, text=True)
            records = [json.loads(line) for line in (base / "commands").read_text().splitlines()]
            up = [r for r in records if r[0][0] == "compose" and "up" in r[0]]
            pinned = promotion.IMAGE + "@" + DIGEST
            if not failure:
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual([r[1] for r in up], [pinned])
                self.assertEqual((state / "current-image.txt").read_text().strip(), pinned)
                self.assertEqual((state / "requested-image.txt").read_text().strip(), reference)
                pulls = [r[0] for r in records if r[0][0] == "pull"]
                self.assertEqual(pulls, [["pull", pinned]])
                previous = (state / "previous-image.txt").read_text().strip()
                result = subprocess.run(["bash", str(script), "rollback"], env=env, capture_output=True)
                self.assertEqual(result.returncode, 0)
                last = json.loads((base / "commands").read_text().splitlines()[-1])
                self.assertEqual(last[1], previous)
            else:
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual((state / "current-image.txt").read_text(), "previous")
                if failure in ("health", "image"):
                    self.assertEqual(len(up), 2)
                    self.assertEqual(up[0][1], pinned)
                    self.assertTrue(up[1][1].startswith("wuchuang-new-api:rollback-"))
                else:
                    self.assertEqual(up, [])
                    self.assertFalse((state / "previous-image.txt").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
