const test = require("node:test");
const assert = require("node:assert");

const { diffSegments } = require("../src/diff.js");

// テスト用のセグメントを組み立てる
function seg(start, end, text, speaker = null) {
  return { start, end, speaker, text };
}

test("変更がなければ差分は空", () => {
  const prev = [seg(0, 5, "foo"), seg(5, 10, "bar")];
  const next = [seg(0, 5, "foo"), seg(5, 10, "bar")];

  assert.deepStrictEqual(diffSegments(prev, next), []);
});

test("1件のテキスト編集を edit として拾う", () => {
  const prev = [seg(0, 5, "foo"), seg(5, 10, "bar")];
  const next = [seg(0, 5, "foo"), seg(5, 10, "baz")];

  assert.deepStrictEqual(diffSegments(prev, next), [
    { kind: "edit", start: 5, end: 10, before: "bar", after: "baz" },
  ]);
});

test("話者だけの変更を speaker として拾う", () => {
  const prev = [seg(0, 5, "foo", null)];
  const next = [seg(0, 5, "foo", "speaker-1")];

  assert.deepStrictEqual(diffSegments(prev, next), [
    { kind: "speaker", start: 0, end: 5, before: null, after: "speaker-1" },
  ]);
});

test("複数件のテキスト編集を時間順に並べて拾う", () => {
  const prev = [seg(0, 5, "foo"), seg(5, 10, "bar"), seg(10, 15, "foo")];
  const next = [seg(0, 5, "qux"), seg(5, 10, "bar"), seg(10, 15, "qux")];

  assert.deepStrictEqual(diffSegments(prev, next), [
    { kind: "edit", start: 0, end: 5, before: "foo", after: "qux" },
    { kind: "edit", start: 10, end: 15, before: "foo", after: "qux" },
  ]);
});

test("2件が1件になったら merge として拾う", () => {
  const prev = [seg(0, 5, "foo"), seg(5, 10, "bar"), seg(10, 15, "baz")];
  const next = [seg(0, 10, "foobar"), seg(10, 15, "baz")];

  assert.deepStrictEqual(diffSegments(prev, next), [
    { kind: "merge", start: 0, end: 10, before: "foo\nbar", after: "foobar" },
  ]);
});

test("1件が2件になったら split として拾う", () => {
  const prev = [seg(0, 10, "foobar"), seg(10, 15, "baz")];
  const next = [seg(0, 5, "foo"), seg(5, 10, "bar"), seg(10, 15, "baz")];

  assert.deepStrictEqual(diffSegments(prev, next), [
    { kind: "split", start: 0, end: 10, before: "foobar", after: "foo\nbar" },
  ]);
});

// LISTEN の実データではセグメント間にわずかな隙間があり、結合前の2件は
// 時間的に連続していない (例: 15.78 で終わり 16.76 で始まる)
test("時間が連続していないセグメント同士の結合も merge として拾う", () => {
  const prev = [
    seg(2.26, 15.78, "foo"),
    seg(16.76, 44.28, "bar"),
    seg(44.28, 62.66, "baz"),
  ];
  const next = [seg(2.26, 44.28, "foobar"), seg(44.28, 62.66, "baz")];

  assert.deepStrictEqual(diffSegments(prev, next), [
    { kind: "merge", start: 2.26, end: 44.28, before: "foo\nbar", after: "foobar" },
  ]);
});

test("結合を元に戻した場合は split として拾う", () => {
  const prev = [seg(2.26, 44.28, "foobar"), seg(44.28, 62.66, "baz")];
  const next = [
    seg(2.26, 15.78, "foo"),
    seg(16.76, 44.28, "bar"),
    seg(44.28, 62.66, "baz"),
  ];

  assert.deepStrictEqual(diffSegments(prev, next), [
    { kind: "split", start: 2.26, end: 44.28, before: "foobar", after: "foo\nbar" },
  ]);
});

test("結合でも分割でもない構造変更は other にする", () => {
  const prev = [seg(0, 5, "foo"), seg(5, 10, "bar")];
  const next = [seg(0, 4, "foo"), seg(4, 10, "bar")];

  assert.deepStrictEqual(diffSegments(prev, next), [
    { kind: "other", start: 0, end: 10, before: "foo\nbar", after: "foo\nbar" },
  ]);
});

test("start/end の微小な誤差は同じセグメントとして扱う", () => {
  const prev = [seg(2.259999, 15.78, "foo")];
  const next = [seg(2.26, 15.78, "bar")];

  assert.deepStrictEqual(diffSegments(prev, next), [
    { kind: "edit", start: 2.26, end: 15.78, before: "foo", after: "bar" },
  ]);
});

test("セグメントが増減しても未変更部分は差分に含めない", () => {
  const prev = [seg(0, 5, "foo"), seg(5, 10, "bar"), seg(10, 15, "baz")];
  const next = [seg(0, 5, "foo"), seg(5, 15, "barbaz")];

  assert.deepStrictEqual(diffSegments(prev, next), [
    { kind: "merge", start: 5, end: 15, before: "bar\nbaz", after: "barbaz" },
  ]);
});
