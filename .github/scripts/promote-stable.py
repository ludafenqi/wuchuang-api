"""Verify the published main image before updating its stable registry alias."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time


IMAGE = "ghcr.io/ludafenqi/wuchuang-api"


def command(*args):
    return subprocess.check_output(args)


def require_current_release():
    expected = {
        "GITHUB_REPOSITORY": "ludafenqi/wuchuang-api",
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_EVENT_NAME": "workflow_dispatch",
    }
    for key, value in expected.items():
        if os.environ.get(key) != value:
            raise RuntimeError("Stable promotion requires a manual main release")
    sha = os.environ["GITHUB_SHA"]
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise RuntimeError("Invalid source revision")
    main = command("git", "ls-remote", "origin", "refs/heads/main").decode().split()
    if not main or main[0] != sha:
        raise RuntimeError("Main advanced during this release")
    runs = json.loads(command(
        "gh", "api",
        "repos/ludafenqi/wuchuang-api/actions/workflows/wuchuang-publish-ghcr.yml/runs"
        "?branch=main&event=workflow_dispatch&per_page=1",
    ))["workflow_runs"]
    if not runs or str(runs[0]["id"]) != os.environ["GITHUB_RUN_ID"]:
        raise RuntimeError("A newer main publication was requested")


def registry_index(reference, digest):
    raw = command("docker", "buildx", "imagetools", "inspect", reference, "--raw")
    if "sha256:" + hashlib.sha256(raw).hexdigest() != digest:
        raise RuntimeError("Registry index differs from the published digest")
    return json.loads(raw)


def verify_runtime(reference, sha, directory):
    command("docker", "pull", "--platform", "linux/amd64", reference)
    image = json.loads(command("docker", "image", "inspect", reference))[0]
    labels = image["Config"]["Labels"]
    if ((image["Os"], image["Architecture"]) != ("linux", "amd64")
            or labels["org.opencontainers.image.revision"] != sha
            or labels["org.opencontainers.image.source"] != "https://github.com/ludafenqi/wuchuang-api"):
        raise RuntimeError("Published image platform or source mismatch")
    name = "wucora-stable-" + os.environ["GITHUB_RUN_ID"]
    try:
        command(
            "docker", "run", "-d", "--name", name, "--network", "none",
            "--tmpfs", "/data:rw,size=256m", "-e", "UPDATE_TASK=false",
            "-e", "SESSION_SECRET=disposable-stable-verification",
            "-e", "SQL_DSN=", "-e", "LOG_SQL_DSN=", "-e", "REDIS_CONN_STRING=",
            reference,
        )
        for attempt in range(60):
            status = subprocess.run(
                ["docker", "exec", name, "wget", "-qO-", "http://127.0.0.1:3000/api/status"],
                capture_output=True,
            )
            if status.returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError("Published image readiness failed")
        data = json.loads(status.stdout)
        if not data["success"] or data["data"]["source_revision"] != sha:
            raise RuntimeError("Running service source revision mismatch")
        (directory / "status.json").write_bytes(status.stdout)
        for file in ("LICENSE", "NOTICE", "THIRD-PARTY-LICENSES.md"):
            command("docker", "cp", f"{name}:/licenses/{file}", str(directory / file))
            if (directory / file).read_bytes() != Path(file).read_bytes():
                raise RuntimeError("Packaged license differs from Git source")
        html = command("docker", "exec", name, "wget", "-qO-", "http://127.0.0.1:3000/")
        assets = re.findall(rb'(?:src|href)="(/[^"]+\.(?:js|css)(?:\?[^"]*)?)"', html)
        if not assets:
            raise RuntimeError("Packaged frontend has no embedded assets")
        payloads = [command("docker", "exec", name, "wget", "-qO-",
                            "http://127.0.0.1:3000" + asset.decode()) for asset in assets]
        if not any(b"WuCora" in body for body in payloads) or not any(sha.encode() in body for body in payloads):
            raise RuntimeError("Embedded frontend brand or source revision mismatch")
        return {"platform": "linux/amd64", "imageID": image["Id"], "assets": len(assets)}
    finally:
        command("docker", "rm", "-f", name)


def promote():
    require_current_release()
    sha, digest = os.environ["GITHUB_SHA"], os.environ["DIGEST"]
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        raise RuntimeError("Invalid published digest")
    directory = Path(os.environ["RUNNER_TEMP"]) / "stable-release"
    directory.mkdir(parents=True, exist_ok=True)
    reference, tag = IMAGE + "@" + digest, IMAGE + ":sha-" + sha
    index = registry_index(reference, digest)
    if registry_index(tag, digest) != index:
        raise RuntimeError("SHA tag differs from the published image")
    platforms = [m for m in index["manifests"] if m.get("platform", {}).get("architecture") == "amd64"
                 and m.get("platform", {}).get("os") == "linux"]
    if len(platforms) != 1 or not any(
        m.get("annotations", {}).get("vnd.docker.reference.digest") == platforms[0]["digest"]
        and m.get("annotations", {}).get("vnd.docker.reference.type") == "attestation-manifest"
        for m in index["manifests"]
    ):
        raise RuntimeError("Missing linux/amd64 image or linked provenance")
    runtime = verify_runtime(reference, sha, directory)
    # Repeat after pulling and running the exact image, immediately before mutation.
    require_current_release()
    command("docker", "buildx", "imagetools", "create", "--tag", IMAGE + ":stable", reference)
    if registry_index(IMAGE + ":stable", digest) != index:
        raise RuntimeError("Stable differs from the verified OCI index")
    evidence = dict(sourceRevision=sha, digest=digest, tag=tag, stable=IMAGE + ":stable",
                    platformManifest=platforms[0]["digest"], runtime=runtime, cleanup=True)
    (directory / "release.json").write_text(json.dumps(evidence, indent=2) + "\n")
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
        summary.write(f"\nFixed pull tag: `{IMAGE}:stable`\n\nVerified image: `{reference}`\n")


if __name__ == "__main__":
    promote()
