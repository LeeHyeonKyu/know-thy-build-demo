// 노트 규칙. HTTP도 SQL도 모른다(docs/TECHNICAL.md §Architecture "NOT Responsible For: HTTP").
// 그래서 검증 오류에는 상태코드를 싣지 않는다 — 상태코드 매핑은 src/app.js의 에러 핸들러가 한다.

export const INVALID_REQUEST = "invalid_request";

const REQUIRED_FIELDS = ["title", "body"];

function invalidRequest(message) {
  const err = new Error(message);
  err.code = INVALID_REQUEST;
  return err;
}

/**
 * 새 노트 입력을 검증해 저장 가능한 형태로 돌려준다.
 * 통과하면 앞뒤 공백만 제거한 `{ title, body }`이고, 그 밖의 필드는 결과에 실리지 않는다
 * (docs/features/001-create-note.md:64 — 무시하되 응답에 포함하지 않는다).
 * 실패하면 `code = "invalid_request"`와 문제된 필드명이 든 message로 throw한다.
 */
export function validateNewNote(input) {
  const source = input ?? {};
  const note = {};

  for (const field of REQUIRED_FIELDS) {
    const value = source[field];
    if (typeof value !== "string") {
      throw invalidRequest(`${field} is required`);
    }
    const trimmed = value.trim();
    if (trimmed === "") {
      throw invalidRequest(`${field} must not be blank`);
    }
    note[field] = trimmed;
  }

  return note;
}
