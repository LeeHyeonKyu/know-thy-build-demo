// dw3 — src/service/notes.js 의 검증 계약을 DB·HTTP 없이 고정한다.
// docs/TECHNICAL.md §Architecture: service는 HTTP를 모른다 → 오류에 상태코드가 실리면 안 된다.
// docs/features/001-create-note.md:58,:61,:62,:64,:71,:77
import { describe, expect, test } from "vitest";
import { validateNewNote } from "../src/service/notes.js";
import { makeNote } from "./fixtures/notes.js";

// 검증 실패를 "던졌다"가 아니라 "무엇을 던졌는지"로 관측한다.
function rejectionOf(input) {
  try {
    validateNewNote(input);
  } catch (err) {
    return err;
  }
  throw new Error(`validateNewNote(${JSON.stringify(input)}) did not reject`);
}

describe("issue #2 — service validation contract", () => {
  test("test_2_service_validation_contract", () => {
    // (1) 네 무효 케이스가 모두 거부되고, message가 *문제된 그 필드*를 지목한다.
    //     범용 "invalid request"나 "title or body is required"는 여기서 떨어진다.
    const invalid = [
      { label: "title missing", input: { body: makeNote().body }, field: "title", other: "body" },
      { label: "title blank", input: makeNote({ title: " \t\n " }), field: "title", other: "body" },
      { label: "body missing", input: { title: makeNote().title }, field: "body", other: "title" },
      { label: "body blank", input: makeNote({ body: "   " }), field: "body", other: "title" },
    ];

    for (const { label, input, field, other } of invalid) {
      const err = rejectionOf(input);
      expect(err.code, label).toBe("invalid_request");
      expect(err.message, label).toContain(field);
      expect(err.message, label).not.toContain(other);
      // service는 HTTP를 모른다(docs/TECHNICAL.md:42 "NOT Responsible For: HTTP").
      expect(err.status, label).toBeUndefined();
      expect(err.statusCode, label).toBeUndefined();
      expect(Object.keys(err), label).not.toContain("status");
      expect(Object.keys(err), label).not.toContain("statusCode");
    }

    // (2) 통과 케이스는 앞뒤만 트림한다 — 내용 절단이 아니다.
    //     안쪽 공백·개행·유니코드가 그대로 살아 있는지 전체 문자열로 단언한다.
    const padded = makeNote({
      title: "  pg pool leak  ",
      body: "\n max=10이면\t커넥션이  모자란다 \n",
    });
    const accepted = validateNewNote(padded);
    expect(accepted.title).toBe("pg pool leak");
    expect(accepted.body).toBe("max=10이면\t커넥션이  모자란다");

    // (3) 알 수 없는 필드는 400이 아니다 — 통과하되 결과에 실리지 않는다
    //     (docs/features/001-create-note.md:64 "무시하되 응답에 포함하지 않는다" 양쪽 절).
    const withUnknown = validateNewNote(
      makeNote({ id: 99, created_at: "1999-01-01T00:00:00Z", nickname: "mina" }),
    );
    expect(Object.keys(withUnknown).sort()).toEqual(["body", "title"]);
    expect(withUnknown.title).toBe(makeNote().title);
    expect(withUnknown.body).toBe(makeNote().body);

    // (4) fixture는 매 호출 새 객체다 — 통과 케이스가 입력 객체를 변조하지 않는다.
    expect(padded.title).toBe("  pg pool leak  ");
  });
});
