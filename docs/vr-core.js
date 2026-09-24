// 밸류 리밸런싱(VR) 계산 로직 — 『라오어의 미국주식 밸류 리밸런싱』 PART4·실력공식편 기준
(function (root) {
  const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

  // 사이클당 현금 흐름: 적립식 +, 인출식 −, 거치식 0
  function flow(settings) {
    const amt = Math.abs(Number(settings.contrib) || 0);
    if (settings.mode === "accum") return amt;
    if (settings.mode === "withdraw") return -amt;
    return 0;
  }

  // 새 V 계산
  //   기본공식: V₂ = V₁ + Pool/G ± 적립/인출
  //   실력공식: V₂ = V₁ + Pool/G + (E − V₁)/(2√G) ± 적립/인출
  function nextV({ V1, poolEnd, E, G, c, formula }) {
    const poolTerm = poolEnd / G;
    const skillTerm = formula === "skill" ? (E - V1) / (2 * Math.sqrt(G)) : 0;
    return { V: r2(V1 + poolTerm + skillTerm + c), poolTerm: r2(poolTerm), skillTerm: r2(skillTerm) };
  }

  function bands(V, bandPct) {
    return { min: r2(V * (1 - bandPct)), max: r2(V * (1 + bandPct)) };
  }

  // 매수표: 매수점 = 최소밴드 ÷ 현재 보유개수, 1개씩.
  // 누적 매수액이 Pool × 사용한도에 "가장 가까운" 지점까지만 건다(책의 표와 동일한 규칙).
  function buyOrders(minBand, shares, pool, limitPct) {
    const out = [];
    if (!(shares > 0) || !(pool > 0)) return out;
    const limit = pool * limitPct;
    let cum = 0;
    for (let k = 0; k < 2000; k++) {
      const n = shares + k;
      const price = r2(minBand / n);
      if (!(price > 0)) break;
      const next = cum + price;
      if (next > pool) break;
      if (next > limit) {
        if (next - limit < limit - cum) out.push({ price, qty: 1, holdAfter: n + 1, poolAfter: r2(pool - next) });
        break;
      }
      cum = next;
      out.push({ price, qty: 1, holdAfter: n + 1, poolAfter: r2(pool - cum) });
    }
    return out;
  }

  // 매도표: 매도점 = 최대밴드 ÷ 현재 보유개수, 1개씩. 매도는 한도 없음.
  function sellOrders(maxBand, shares, pool, count) {
    const out = [];
    let cum = 0;
    for (let n = shares; n >= 1 && out.length < count; n--) {
      const price = r2(maxBand / n);
      cum += price;
      out.push({ price, qty: 1, holdAfter: n - 1, poolAfter: r2(pool + cum) });
    }
    return out;
  }

  // k개씩 묶기: 매수는 묶음의 가장 낮은 가격, 매도는 가장 높은 가격에 k개
  function group(orders, k, startPool, side) {
    if (k <= 1) return orders;
    const out = [];
    let pool = startPool;
    for (let i = k - 1; i < orders.length; i += k) {
      const o = orders[i];
      pool = side === "buy" ? pool - o.price * k : pool + o.price * k;
      out.push({ price: o.price, qty: k, holdAfter: o.holdAfter, poolAfter: r2(pool) });
    }
    return out;
  }

  const api = { r2, flow, nextV, bands, buyOrders, sellOrders, group };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.VRCore = api;
})(typeof window !== "undefined" ? window : globalThis);
