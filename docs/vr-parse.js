// 증권사 앱 캡처의 글자 인식 결과(줄·단어·위치)에서 보유 수량, 현재가, 현금을 찾는다.
// lines: [{ text, words: [{ t, x0, x1 }] }]
(function (root) {
  const HEADER_WORDS = ["종목명", "종목코드", "보유수량", "잔고수량", "현재가", "평가손익", "평가금액", "매도가능",
    "평균단가", "매입단가", "매입가", "수익률", "손익률", "구분"];
  const SHARES_KEYS = ["보유수량", "잔고수량", "보유량", "수량"];
  const PRICE_KEYS = ["현재가", "종가", "시세"];

  const squash = (s) => s.replace(/\s+/g, "");
  const hasDigit = (s) => /\d/.test(s);
  const NUM_RE = /^[\$₩]?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(주|원)?$/;
  const numOf = (t) => { const m = t.match(NUM_RE); return m ? Number(m[1].replace(/,/g, "")) : null; };

  // 글자 단위로 쪼개진 단어들 속에서 keyword가 차지하는 가로 위치(가운데)를 찾는다
  function locate(line, keyword) {
    let joined = "", owners = [];
    line.words.forEach((w, i) => { const s = squash(w.t); joined += s; for (let k = 0; k < s.length; k++) owners.push(i); });
    const at = joined.indexOf(keyword);
    if (at < 0) return null;
    const ws = owners.slice(at, at + keyword.length).map((i) => line.words[i]);
    const x0 = Math.min(...ws.map((w) => w.x0)), x1 = Math.max(...ws.map((w) => w.x1));
    return (x0 + x1) / 2;
  }

  function numbersOn(line) {
    return line.words
      .filter((w) => !/%/.test(w.t))
      .map((w) => ({ v: numOf(squash(w.t)), c: (w.x0 + w.x1) / 2 }))
      .filter((n) => n.v != null);
  }

  // 표 형태: 제목 줄(숫자 없음, 제목 단어 2개 이상)이 한 줄 이상, 그 아래에 종목마다 같은 줄 수만큼 숫자 줄
  function fromTable(lines, width) {
    const isHeader = (l) => !hasDigit(l.text) && HEADER_WORDS.filter((k) => squash(l.text).includes(k)).length >= 2;
    const h = lines.findIndex(isHeader);
    if (h < 0) return {};
    let period = 1;
    while (h + period < lines.length && isHeader(lines[h + period])) period++;
    const first = h + period;
    const t = lines.findIndex((l, i) => i >= first && /TQQQ/i.test(l.text));
    const g = t >= 0 ? first + Math.floor((t - first) / period) * period : first;
    const tol = width * 0.12;

    const pick = (keys, wantInt) => {
      for (let s = 0; s < period; s++) {
        const hl = lines[h + s];
        for (const k of keys) {
          const x = locate(hl, k);
          if (x == null) continue;
          const dl = lines[g + s];
          if (!dl) return null;
          const cands = numbersOn(dl).filter((n) => Math.abs(n.c - x) < tol && (!wantInt || Number.isInteger(n.v)));
          cands.sort((a, b) => Math.abs(a.c - x) - Math.abs(b.c - x));
          return cands.length ? cands[0].v : null;
        }
      }
      return null;
    };
    return { shares: pick(SHARES_KEYS, true), price: pick(PRICE_KEYS, false) };
  }

  // 카드 형태: "보유수량 300주"처럼 이름 옆이나 바로 아래 줄에 숫자
  function fromLabels(lines) {
    const find = (keys, ok) => {
      for (let i = 0; i < lines.length; i++) {
        const sq = squash(lines[i].text);
        if (!keys.some((k) => sq.includes(k))) continue;
        for (const l of [lines[i], lines[i + 1]]) {
          if (!l) continue;
          const n = numbersOn(l).map((x) => x.v).find(ok);
          if (n != null) return n;
        }
      }
      return null;
    };
    return {
      shares: find(SHARES_KEYS, (n) => Number.isInteger(n) && n > 0 && n < 1e6),
      price: find(PRICE_KEYS, (n) => n > 0 && n < 1e7),
    };
  }

  // 현금: 예수금·주문가능금액 등. "총 자산", "평가금액" 같은 합계는 제외.
  function findCash(lines) {
    const KEY = /예수금|주문가능금액|주문가능|출금가능|인출가능|매수가능금액|매수가능/;
    for (let i = 0; i < lines.length; i++) {
      const sq = squash(lines[i].text);
      if (!KEY.test(sq) || /자산|총|평가|매입|손익/.test(sq)) continue;
      for (const l of [lines[i], lines[i + 1]]) {
        if (!l) continue;
        const w = l.words.find((x) => numOf(squash(x.t)) != null && !/%/.test(x.t));
        if (!w) continue;
        const v = numOf(squash(w.t));
        const around = squash(l.text);
        const unit = /\$|USD|달러/i.test(around) ? "usd" : /원|₩|KRW/.test(around) ? "krw"
          : (Number.isInteger(v) && v >= 50000 ? "krw" : "usd");
        return { cash: v, cashUnit: unit };
      }
    }
    return { cash: null, cashUnit: null };
  }

  function parseScreen(lines) {
    lines = lines.filter((l) => squash(l.text).length > 2 || hasDigit(l.text)); // ">" 같은 잡음 줄 제거
    const width = Math.max(1, ...lines.flatMap((l) => l.words.map((w) => w.x1)));
    const tbl = fromTable(lines, width);
    const lab = fromLabels(lines);
    const shares = tbl.shares ?? lab.shares;
    const price = tbl.price ?? lab.price;
    const { cash, cashUnit } = findCash(lines);
    return {
      shares: shares ?? null,
      price: price ?? null,
      priceUnit: price == null ? null : price >= 5000 ? "krw" : "usd", // TQQQ는 달러로 수십~수백, 원화로 수만 원
      cash, cashUnit,
    };
  }

  const api = { parseScreen };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.VRParse = api;
})(typeof window !== "undefined" ? window : globalThis);
