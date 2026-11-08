#!/usr/bin/env python3
"""Read GHCR content by digest and preserve only non-secret verification evidence."""
import base64
import hashlib
import json
import os
import pathlib
import re
import urllib.error
import urllib.request
import urllib.parse

root = pathlib.Path(os.environ["RUNNER_TEMP"]) / "image-evidence"
root.mkdir(parents=True, exist_ok=True)
repository = "ludafenqi/wuchuang-api"
image = "ghcr.io/" + repository
expected = os.environ["REGISTRY_DIGEST"]
source = os.environ["PRODUCT_SHA"]
assert re.fullmatch(r"sha256:[0-9a-f]{64}", expected)
assert os.environ["IMAGE"] == image + "@" + expected
base = "https://ghcr.io/v2/" + repository
accept = ", ".join([
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
])
token_url = "https://ghcr.io/token?service=ghcr.io&scope=repository:" + repository + ":pull"


def get(url, headers):
    # Credentials never follow redirects. Registry blobs are commonly on signed
    # storage URLs; these redirects must be fetched without Authorization.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(urllib.request.Request(url, headers=headers), timeout=60) as response:
            return response.read(), dict(response.headers)
    except urllib.error.HTTPError as error:
        if error.code not in (301, 302, 303, 307, 308):
            raise RuntimeError("Registry HTTP " + str(error.code)) from None
        location = error.headers["Location"]
        parsed = urllib.parse.urlparse(location)
        assert parsed.scheme == "https"
        assert parsed.hostname.endswith(".blob.core.windows.net") or parsed.hostname.endswith(".githubusercontent.com") or parsed.hostname == "ghcr.io"
        with urllib.request.urlopen(location, timeout=60) as response:
            return response.read(), dict(response.headers)


anonymous = True
try:
    token_data, _ = get(token_url, {})
except RuntimeError:
    anonymous = False
    auth = base64.b64encode((os.environ["GITHUB_ACTOR"] + ":" + os.environ["GH_TOKEN"]).encode()).decode()
    token_data, _ = get(token_url, {"Authorization": "Basic " + auth})
token = json.loads(token_data)["token"]
headers = {"Authorization": "Bearer " + token, "Accept": accept}


def fetch(kind, ref, name):
    global anonymous, headers
    try:
        data, response_headers = get(base + "/" + kind + "/" + ref, headers)
    except RuntimeError as error:
        if not anonymous or str(error) not in ("Registry HTTP 401", "Registry HTTP 403"):
            raise
        anonymous = False
        auth = base64.b64encode((os.environ["GITHUB_ACTOR"] + ":" + os.environ["GH_TOKEN"]).encode()).decode()
        token_data, _ = get(token_url, {"Authorization": "Basic " + auth})
        headers = {"Authorization": "Bearer " + json.loads(token_data)["token"], "Accept": accept}
        data, response_headers = get(base + "/" + kind + "/" + ref, headers)
    digest = "sha256:" + hashlib.sha256(data).hexdigest()
    if ref.startswith("sha256:"):
        assert digest == ref
    declared = response_headers.get("Docker-Content-Digest") or response_headers.get("docker-content-digest")
    if declared:
        assert declared == digest
    (root / name).write_bytes(data)
    return json.loads(data), digest


index, index_digest = fetch("manifests", expected, "registry-index.json")
assert index_digest == expected
tag_index, tag_digest = fetch("manifests", "sha-" + source, "registry-tag-index.json")
assert tag_digest == expected, "SHA tag moved; immutable target remains fixed"
assert tag_index == index
platforms = [m for m in index["manifests"] if m.get("platform", {}).get("os") == "linux" and m.get("platform", {}).get("architecture") == "amd64"]
assert len(platforms) == 1
platform = platforms[0]
manifest, platform_digest = fetch("manifests", platform["digest"], "registry-platform-manifest.json")
config, config_digest = fetch("blobs", manifest["config"]["digest"], "registry-config.json")
assert config["os"] == "linux" and config["architecture"] == "amd64"
assert config["config"]["Entrypoint"] == ["/new-api"]
assert config["config"]["Labels"]["org.opencontainers.image.revision"] == source
assert config["config"]["Labels"]["org.opencontainers.image.source"] == "https://github.com/ludafenqi/wuchuang-api"
attestations = [m for m in index["manifests"] if m.get("annotations", {}).get("vnd.docker.reference.type") == "attestation-manifest" and m["annotations"].get("vnd.docker.reference.digest") == platform_digest]
assert len(attestations) == 1, "Expected platform-linked provenance manifest"
attestation, attestation_digest = fetch("manifests", attestations[0]["digest"], "registry-attestation-manifest.json")
provenance = []
for number, layer in enumerate(attestation["layers"]):
    statement, digest = fetch("blobs", layer["digest"], "registry-attestation-" + str(number) + ".json")
    if not statement.get("predicateType", "").startswith("https://slsa.dev/provenance/"):
        continue
    assert any(subject.get("digest", {}).get("sha256") == platform_digest.removeprefix("sha256:") for subject in statement["subject"])
    provenance.append({"digest": digest, "predicateType": statement["predicateType"], "subjectMatchesPlatform": True})
assert provenance
resolution = {
    "productSHA": source,
    "productTree": os.environ["PRODUCT_TREE"],
    "workflowSHA": os.environ["GITHUB_SHA"],
    "published": True,
    "imageReference": image + "@" + expected,
    "tagReference": image + ":sha-" + source,
    "registryDigest": index_digest,
    "platformManifestDigest": platform_digest,
    "configDigest": config_digest,
    "platform": "linux/amd64",
    "attestationManifestDigest": attestation_digest,
    "provenance": provenance,
    "tagMatchesExpectedDigest": True,
    "anonymousManifestRead": anonymous,
    "credentialsPersisted": False,
    "signedURLsPersisted": False,
    "rebuilt": False,
}
(root / "registry-resolution.json").write_text(json.dumps(resolution, indent=2) + "\n")
print(json.dumps(resolution))

