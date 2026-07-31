// 文字起こしセグメントの差分を算出する純粋関数。
// content script (classic script) と Node のテストの両方から使えるようにしてある。
(function (root, factory) {
  const api = factory();
  root.ListenDiff = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  // start/end は浮動小数なので、小数第2位に丸めた文字列をキーにする
  function keyOf(segment) {
    return `${segment.start.toFixed(2)}-${segment.end.toFixed(2)}`;
  }

  function joinTexts(segments) {
    return segments.map((s) => s.text).join("\n");
  }

  // 時間帯が重なり合う未対応セグメント同士を1つのグループにまとめる。
  // 結合 (2件→1件) や分割 (1件→2件) は、同じ時間範囲を別の区切り方で
  // 表しているだけなので、この重なりを辿ればひとかたまりになる。
  function groupUnmatched(onlyPrev, onlyNext) {
    const groups = [];
    let pi = 0;
    let ni = 0;

    while (pi < onlyPrev.length || ni < onlyNext.length) {
      const prevGroup = [];
      const nextGroup = [];
      let start;
      let end;

      // 開始が早い方からグループを始める
      const takePrevFirst =
        ni >= onlyNext.length ||
        (pi < onlyPrev.length && onlyPrev[pi].start <= onlyNext[ni].start);
      if (takePrevFirst) {
        start = onlyPrev[pi].start;
        end = onlyPrev[pi].end;
        prevGroup.push(onlyPrev[pi]);
        pi += 1;
      } else {
        start = onlyNext[ni].start;
        end = onlyNext[ni].end;
        nextGroup.push(onlyNext[ni]);
        ni += 1;
      }

      // グループの終端より前に始まるセグメントを、伸びなくなるまで取り込む
      let grew = true;
      while (grew) {
        grew = false;
        while (pi < onlyPrev.length && onlyPrev[pi].start < end) {
          end = Math.max(end, onlyPrev[pi].end);
          prevGroup.push(onlyPrev[pi]);
          pi += 1;
          grew = true;
        }
        while (ni < onlyNext.length && onlyNext[ni].start < end) {
          end = Math.max(end, onlyNext[ni].end);
          nextGroup.push(onlyNext[ni]);
          ni += 1;
          grew = true;
        }
      }

      groups.push({ start, end, prev: prevGroup, next: nextGroup });
    }

    return groups;
  }

  function kindOfGroup(group) {
    if (group.prev.length >= 2 && group.next.length === 1) return "merge";
    if (group.prev.length === 1 && group.next.length >= 2) return "split";
    return "other";
  }

  function diffSegments(prev, next) {
    const prevByKey = new Map(prev.map((s) => [keyOf(s), s]));
    const nextKeys = new Set(next.map(keyOf));

    const changes = [];
    const onlyNext = [];

    for (const after of next) {
      const before = prevByKey.get(keyOf(after));
      if (!before) {
        onlyNext.push(after);
        continue;
      }
      if (before.text !== after.text) {
        changes.push({
          kind: "edit",
          start: after.start,
          end: after.end,
          before: before.text,
          after: after.text,
        });
      } else if (before.speaker !== after.speaker) {
        changes.push({
          kind: "speaker",
          start: after.start,
          end: after.end,
          before: before.speaker,
          after: after.speaker,
        });
      }
    }

    const onlyPrev = prev.filter((s) => !nextKeys.has(keyOf(s)));

    for (const group of groupUnmatched(onlyPrev, onlyNext)) {
      changes.push({
        kind: kindOfGroup(group),
        start: group.start,
        end: group.end,
        before: joinTexts(group.prev),
        after: joinTexts(group.next),
      });
    }

    changes.sort((a, b) => a.start - b.start);
    return changes;
  }

  return { diffSegments };
});
