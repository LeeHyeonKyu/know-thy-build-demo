import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "node:url";

// #58: readVersion()는 src/version.js로 옮겨졌고 HTTP 서버를 띄우지 않고 단위로 검증한다.
// readVersion()은 인자가 없고 모듈 상수 MANIFEST_PATH를 읽으므로(#39 dw5 — 모듈 위치 기준),
// 매니페스트 내용은 node:fs의 readFileSync를 케이스마다 바꿔 끼워 공급한다.
// 모듈 최상단에서 파일을 읽지 않으므로(부팅 시 1회 호출은 src/app.js에 남아 있다) import 순서나
// 모듈 캐시에 의존하지 않는다 — 읽기는 전부 각 테스트 안의 readVersion() 호출에서 일어난다.
const { readFileSyncMock } = vi.hoisted(() => ({ readFileSyncMock: vi.fn() }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, readFileSync: readFileSyncMock };
});

const { readVersion, MANIFEST_PATH, UNKNOWN_VERSION } = await import("../src/version.js");

// 레포 루트의 package.json — src/version.js 기준 ../package.json과 같은 파일이어야 한다.
const REPO_MANIFEST = fileURLToPath(new URL("../package.json", import.meta.url));

function manifestReturns(text) {
  readFileSyncMock.mockImplementation((path, encoding) => {
    // 모듈 위치 기준 경로만 응답한다 — 다른 경로를 읽는 구현은 여기서 ENOENT를 맞는다.
    if (path !== REPO_MANIFEST) {
      const err = new Error(`ENOENT: no such file or directory, open '${path}'`);
      err.code = "ENOENT";
      throw err;
    }
    expect(encoding).toBe("utf8");
    return text;
  });
}

describe("#58 readVersion() in src/version.js", () => {
  beforeEach(() => {
    readFileSyncMock.mockReset();
  });
  afterEach(() => {
    readFileSyncMock.mockReset();
    vi.restoreAllMocks();
  });

  it("test_58_read_version_returns_declared_version", () => {
    manifestReturns(JSON.stringify({ name: "x", version: "4.7.1-rc.2" }));
    expect(readVersion()).toBe("4.7.1-rc.2");
    expect(readFileSyncMock).toHaveBeenCalledTimes(1);
  });

  it("test_58_read_version_missing_field_is_unknown", () => {
    manifestReturns(JSON.stringify({ name: "x", private: true }));
    expect(UNKNOWN_VERSION).toBe("unknown");
    expect(readVersion()).toBe("unknown");
    expect(readFileSyncMock).toHaveBeenCalledTimes(1);
  });

  it("test_58_read_version_non_string_is_unknown", () => {
    manifestReturns(JSON.stringify({ name: "x", version: 3 }));
    expect(readVersion()).toBe("unknown");
    // 문자열로 바뀌어 새어 나가서도 안 된다.
    expect(readVersion()).not.toBe("3");
    expect(readFileSyncMock).toHaveBeenCalled();

    // JSON의 비문자열(number/bool/null/array/object)은 전부 `.trim`이 없어 catch로도 'unknown'이
    // 된다 — 그래서 위 단언만으로는 `typeof declared === "string"` 가드를 지워도 통과한다.
    // 문자열처럼 `.trim()`이 동작하지만 문자열이 아닌 값(String 래퍼 객체)을 파싱 결과로 주면
    // 그 가드만이 원시값이 아닌 것을 걸러 낸다.
    manifestReturns('{"version":"9.9.9"}');
    const parse = vi.spyOn(JSON, "parse").mockReturnValueOnce({ version: new String("9.9.9") });
    const result = readVersion();
    expect(parse).toHaveBeenCalledTimes(1);
    expect(typeof result).toBe("string");
    expect(result).toBe("unknown");
  });

  it("test_58_read_version_unreadable_manifest_is_unknown", () => {
    readFileSyncMock.mockImplementation(() => {
      const err = new Error("EACCES: permission denied");
      err.code = "EACCES";
      throw err;
    });
    expect(() => readVersion()).not.toThrow();
    expect(readVersion()).toBe("unknown");
    // 프로덕션 경로는 cwd가 아니라 모듈 위치 기준으로 레포의 package.json을 가리킨다 (#39 dw5).
    expect(MANIFEST_PATH).toBe(REPO_MANIFEST);
    expect(readFileSyncMock).toHaveBeenCalledWith(REPO_MANIFEST, "utf8");
  });
});
