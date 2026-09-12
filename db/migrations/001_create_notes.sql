-- 001 · notes 테이블 (docs/TECHNICAL.md §Data)
-- 전진 전용이다. 되돌림(DROP TABLE)은 출하하지 않는다 — 파괴적 스키마 변경은
-- docs/factory/CHARTER.md의 NEVER_AUTOMATE이고, 사람이 psql로 판단해 실행한다.
-- `created_at`의 default now()는 fallback이다: 값은 앱이 주입된 시계로 만들어 INSERT가 명시한다.
create table if not exists notes (
  id         bigserial   primary key,
  title      text        not null,
  body       text        not null,
  created_at timestamptz not null default now()
);
