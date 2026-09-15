/* ICU 관리자 모드 — 회원 화면 안에서 정기모임 일정과 참석을 바로 고친다.
   index.html 은 이 기기에 관리자 열쇠(토큰)가 있거나 주소 끝이 #admin 일 때만 이 파일을 불러온다.
   회원 화면에는 아무것도 더하지 않는다. 저장 권한은 GitHub가 판단한다 — 열쇠 없이는 저장되지 않는다.
   열쇠는 이 기기 브라우저에만 두고 api.github.com 말고는 어디에도 보내지 않는다.

   회원 화면의 전역 D · nextMeeting() · drawMeeting() · drawMeets() 를 그대로 쓴다.
   저장한 내용은 meeting.json: { confirmed:[{date,time,place,note,status,replaces,saved}],
                                 attendance:{ "YYYY-MM-DD": {present,guests,saved} } } */
(() => {
  if (window.__icuAdmin) return;
  window.__icuAdmin = true;

  const OWNER = "xdsport2288-droid", REPO = "icu", FILE = "meeting.json", KEY = "icu_admin_token";
  const API = "https://api.github.com/repos/" + OWNER + "/" + REPO;
  const R = D.meeting_rule;
  let token = "", data = { confirmed: [], attendance: {} }, sha = null;
  try { token = localStorage.getItem(KEY) || ""; } catch (e) {}

  /* ── 작은 도구 ── */
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const E = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const pad = n => String(n).padStart(2, "0");
  const ymd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const iso = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const show = d => d.getFullYear() + "." + pad(d.getMonth() + 1) + "." + pad(d.getDate()) + "(" + "일월화수목금토"[d.getDay()] + ")";
  const today = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };
  const qkey = d => d.getFullYear() + "-Q" + (Math.floor(d.getMonth() / 3) + 1);
  const qname = k => k.slice(2, 4) + "년 " + k.slice(-1) + "분기";
  // 날짜 칸이 "YYYY-MM"이면 달만 정한 일정(날짜 미정, 상태는 언제나 조율 중)
  const isMonth = s => /^\d{4}-\d{2}$/.test(s || "");
  const firstOf = c => ymd(isMonth(c.date) ? c.date + "-01" : c.date);
  const lastOf = c => { const d = firstOf(c); return isMonth(c.date) ? new Date(d.getFullYear(), d.getMonth() + 1, 0) : d; };
  const label = c => isMonth(c.date) ? c.date.slice(0, 4) + "." + c.date.slice(5) + "월 중 (날짜 미정)" : show(ymd(c.date));
  // 장소 이름(place)과 지도 링크(map). 예전처럼 장소 칸에 링크만 들어 있으면 지도 링크로 본다.
  const urlIn = s => (String(s || "").match(/https?:\/\/[^\s<>"']+/i) || [""])[0];
  const linkOnly = s => /^\s*https?:\/\//i.test(s || "");
  const placeText = c => (linkOnly(c.place) ? "" : c.place || "");
  const mapOf = c => urlIn(c.map) || (linkOnly(c.place) ? urlIn(c.place) : "");
  const b64e = s => { let b = ""; new TextEncoder().encode(s).forEach(x => { b += String.fromCharCode(x); }); return btoa(b); };
  const b64d = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, "")), c => c.charCodeAt(0)));
  const headers = t => ({ Authorization: "Bearer " + t, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });
  const stOf = c => (c.status === "조율" || c.status === "예정" ? "조율" : "확정");
  const tag = st => '<span class="adm-tag ' + ({ "확정": 'ok">확정', "조율": 'tune">조율 중' }[st] || '">예정') + '</span>';
  const ACTIVE = () => D.members.filter(m => (D.roster.gone_names || []).indexOf(m.name) < 0).sort((a, b) => a.no - b.no);

  /* ── 모양 — 회원 화면의 색 변수를 그대로 쓴다 ── */
  document.head.appendChild(el("style", null, `
.adm-row{display:flex; flex-wrap:wrap; gap:8px; margin-top:12px}
.adm-btn{font:inherit; font-size:13.5px; font-weight:600; padding:6px 12px; border-radius:3px; cursor:pointer;
  border:1px solid var(--sea); background:transparent; color:var(--sea); line-height:1.3}
.att .adm-btn{margin-left:auto}
.adm-tabs{display:flex; margin:2px 0 12px; border:1px solid var(--sea); border-radius:4px; overflow:hidden}
.adm-tabs button{flex:1; font:inherit; font-size:15px; font-weight:600; padding:9px 8px; cursor:pointer; border:0;
  background:transparent; color:var(--sea)}
.adm-tabs button.on{background:var(--sea); color:var(--surface)}
.adm-foot{margin-top:20px; padding-top:12px; border-top:1px solid var(--line-2); display:flex; flex-wrap:wrap;
  align-items:center; gap:6px 12px; font-size:12.5px; color:var(--muted)}
.adm-foot button{margin-left:auto; font:inherit; font-size:12.5px; background:transparent; border:0; padding:0;
  color:var(--muted); text-decoration:underline; cursor:pointer}
.adm-ov{position:fixed; inset:0; z-index:60; background:rgba(0,0,0,.5); display:flex; align-items:flex-end; justify-content:center}
.adm-sheet{width:100%; max-width:560px; max-height:88vh; overflow:auto; background:var(--surface); color:var(--ink);
  border-radius:10px 10px 0 0; padding:16px 18px 24px; font-size:14.5px}
.adm-sheet .hd{display:flex; align-items:center; gap:10px; margin-bottom:6px}
.adm-sheet .hd h3{margin:0; font-size:18px; font-weight:700; color:var(--sea)}
.adm-sheet .hd .x{margin-left:auto; font-size:18px; background:transparent; border:0; color:var(--muted); cursor:pointer; padding:4px 8px}
.adm-sheet .muted{color:var(--muted); font-size:13px; margin:0}
.adm-sheet label.k{display:block; margin-top:12px; font-size:13px; font-weight:600; color:var(--muted)}
.adm-sheet input[type=text], .adm-sheet input[type=url], .adm-sheet input[type=date], .adm-sheet input[type=month], .adm-sheet input[type=time], .adm-sheet input[type=password]{
  display:block; width:100%; min-width:0; margin-top:4px; padding:10px 10px; font:inherit; font-size:16px; color:var(--ink);
  background:var(--surface-2); border:1px solid var(--line); border-radius:3px; box-sizing:border-box}
.adm-sheet input[type=date], .adm-sheet input[type=month], .adm-sheet input[type=time]{font-family:"IBM Plex Mono",monospace; font-size:15px; padding:10px 6px}
.adm-two{display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:0 12px}
.adm-two > div{min-width:0}
.adm-seg{display:flex; flex-wrap:wrap; gap:8px; margin-top:6px}
.adm-seg label{display:flex; align-items:center; gap:6px; padding:8px 12px; font-weight:600; border:1px solid var(--line);
  border-radius:3px; background:var(--surface-2); cursor:pointer}
.adm-seg label:has(input:checked){border-color:var(--sea); background:var(--sea-soft)}
.adm-seg label:has(input:disabled){opacity:.45; cursor:not-allowed}
.adm-chk{display:flex; align-items:center; gap:8px; margin-top:12px; font-weight:600; cursor:pointer}
.adm-chk input{width:18px; height:18px; margin:0}
.adm-sheet [hidden]{display:none !important}
.adm-clr{position:relative; display:block; min-width:0}
.adm-clr input{padding-right:42px !important}
.adm-x{position:absolute; top:4px; bottom:0; right:0; width:42px; display:flex; align-items:center; justify-content:center;
  font:inherit; font-size:15px; color:var(--muted); background:transparent; border:0; cursor:pointer; padding:0}
.adm-clr input:placeholder-shown + .adm-x{display:none}
.adm-btns{display:flex; flex-wrap:wrap; gap:8px; margin-top:14px}
.adm-sheet button.p{font:inherit; font-size:15px; font-weight:600; padding:10px 16px; border-radius:3px; cursor:pointer;
  border:1px solid var(--sea); background:var(--sea); color:var(--surface)}
.adm-sheet button.s{font:inherit; font-size:15px; font-weight:600; padding:10px 16px; border-radius:3px; cursor:pointer;
  border:1px solid var(--sea); background:transparent; color:var(--sea)}
.adm-sheet button.d{font:inherit; font-size:15px; font-weight:600; padding:10px 16px; border-radius:3px; cursor:pointer;
  border:1px solid var(--rust); background:transparent; color:var(--rust)}
.adm-sheet button:disabled{opacity:.45; cursor:not-allowed}
.adm-list{list-style:none; margin:8px 0 0; padding:0}
.adm-list li{display:flex; flex-wrap:wrap; align-items:center; gap:4px 10px; padding:9px 0; border-top:1px solid var(--line-2)}
.adm-list .dt{font-family:"IBM Plex Mono",monospace; font-weight:700}
.adm-list .pl{color:var(--ink-2); flex:1 1 120px}
.adm-list .ac{display:flex; gap:6px; margin-left:auto}
.adm-list button{font:inherit; font-size:13px; font-weight:600; padding:5px 10px; border-radius:3px; cursor:pointer;
  border:1px solid var(--sea); background:transparent; color:var(--sea)}
.adm-list button.del{border-color:var(--rust); color:var(--rust)}
.adm-tag{font-size:11.5px; font-weight:600; padding:2px 7px; border-radius:2px; border:1px solid var(--sea);
  color:var(--sea); background:var(--sea-soft); white-space:nowrap}
.adm-tag.tune{border-color:var(--rust); color:var(--rust); background:var(--rust-soft)}
.adm-tag.ok{border-color:var(--ok); color:var(--ok); background:var(--ok-soft)}
.adm-checks{display:grid; grid-template-columns:repeat(auto-fill,minmax(128px,1fr)); gap:8px; margin-top:6px}
.adm-checks button{display:flex; align-items:center; gap:8px; padding:11px 12px; font:inherit; font-size:15.5px; font-weight:600;
  text-align:left; border-radius:3px; cursor:pointer; background:var(--surface-2); color:var(--ink); border:1px solid var(--line)}
.adm-checks button .no{font-family:"IBM Plex Mono",monospace; font-size:13px; color:var(--faint); min-width:1.4em}
.adm-checks button[aria-pressed="true"]{background:var(--ok-soft); border-color:var(--ok); color:var(--ok)}
.adm-checks button[aria-pressed="true"] .no{color:var(--ok)}
.adm-checks button[aria-pressed="true"]::after{content:"✓"; margin-left:auto; font-weight:700}
.adm-chips{display:flex; flex-wrap:wrap; gap:6px; margin-top:8px}
.adm-chips button{font:inherit; font-size:13.5px; font-weight:600; padding:6px 10px; border-radius:3px; cursor:pointer;
  background:var(--surface-2); color:var(--ink-2); border:1px solid var(--line)}
.adm-chips button.on{background:var(--sea-soft); color:var(--sea); border-color:var(--sea)}
.adm-chips button.guest{background:var(--ok-soft); color:var(--ok); border-color:var(--ok)}
.adm-grow{display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; align-items:end}
.adm-sum{margin:12px 0 0; font-weight:600; color:var(--ink-2)}
.adm-sum .yes{color:var(--ok)} .adm-sum .no{color:var(--rust)}
.adm-sum .rate{font-family:"IBM Plex Mono",monospace; color:var(--rust)} .adm-sum .rate.full{color:var(--ok)}
.adm-sum .rate.mid{color:var(--sea)}
.adm-toast{position:fixed; left:50%; bottom:70px; transform:translateX(-50%); z-index:70; max-width:92vw;
  padding:10px 14px; border-radius:6px; font-weight:600; font-size:14px; box-shadow:0 2px 10px rgba(0,0,0,.3)}
.adm-toast.ok{background:var(--ok-soft); color:var(--ok)} .adm-toast.err{background:var(--rust-soft); color:var(--rust)}
.adm-toast.info{background:var(--sea-soft); color:var(--sea)}
`));

  let toastTimer = 0;
  function toast(text, kind) {
    let t = document.querySelector(".adm-toast");
    if (!t) { t = el("div", "adm-toast"); document.body.appendChild(t); }
    t.className = "adm-toast " + (kind || "info"); t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, kind === "err" ? 7000 : 4500);
  }

  /* ── 아래에서 올라오는 입력 창 ── */
  let ov = null;
  function sheet(title, body) {
    close();
    ov = el("div", "adm-ov");
    const s = el("div", "adm-sheet");
    s.setAttribute("role", "dialog"); s.setAttribute("aria-label", title);
    s.appendChild(el("div", "hd", '<h3>' + E(title) + '</h3><button class="x" type="button" aria-label="닫기">✕</button>'));
    s.appendChild(body);
    // 글자 칸마다 한 번에 지우는 ✕ — 글자가 있을 때만 보인다(placeholder 가 보이면 CSS 로 숨김)
    s.querySelectorAll('input[type=text], input[type=url], input[type=password]').forEach(inp => {
      const w = el("span", "adm-clr"), x = el("button", "adm-x", "✕");
      x.type = "button"; x.setAttribute("aria-label", "지우기"); x.tabIndex = -1;
      inp.parentNode.insertBefore(w, inp); w.append(inp, x);
      x.onclick = () => { inp.value = ""; inp.dispatchEvent(new Event("input", { bubbles: true })); inp.focus(); };
    });
    ov.appendChild(s);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.closest(".x")) close(); });
    document.body.appendChild(ov);
    document.body.style.overflow = "hidden";
    return s;
  }
  function close() { if (ov) { ov.remove(); ov = null; document.body.style.overflow = ""; } }
  document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });

  /* ── GitHub 읽기·저장 ── */
  async function load() {
    const r = await fetch(API + "/contents/" + FILE + "?ref=main&t=" + Date.now(), { headers: headers(token), cache: "no-store" });
    if (r.status === 401) throw new Error("401");
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    sha = j.sha; data = JSON.parse(b64d(j.content));
    data.confirmed = data.confirmed || []; data.attendance = data.attendance || {};
  }
  async function put(next, message) {
    const body = { message, branch: "main", content: b64e(JSON.stringify(next, null, 1) + "\n") };
    if (sha) body.sha = sha;
    const r = await fetch(API + "/contents/" + FILE, { method: "PUT", headers: headers(token), body: JSON.stringify(body) });
    if (r.ok) { sha = (await r.json()).content.sha; data = next; repaint(); return true; }
    if (r.status === 409 || r.status === 422) toast("다른 곳에서 먼저 바뀌었습니다. 새로 불러왔으니 다시 저장해 주세요.", "err");
    else if (r.status === 401) toast("열쇠가 맞지 않거나 기한이 지났습니다. 관리자 메뉴에서 열쇠를 새로 연결해 주세요.", "err");
    else if (r.status === 403 || r.status === 404) toast("이 열쇠로는 저장할 수 없습니다. 열쇠 권한(Contents: Read and write, icu 저장소)을 확인해 주세요.", "err");
    else toast("저장하지 못했습니다 (" + r.status + "). 잠시 뒤 다시 해 주세요.", "err");
    try { await load(); repaint(); } catch (e) {}
    return false;
  }

  /* 저장하면 GitHub Pages 반영(1~2분)을 기다리지 않고 내 화면부터 바로 새로 그린다 */
  function repaint() {
    drawMeeting(R, data.confirmed);
    drawMeets(data.attendance, data.confirmed);
    decorate();
  }

  /* ── 회원 화면에 관리 버튼 달기 ── */
  function decorate() {
    const nm = document.getElementById("nextmeet");
    if (nm && !nm.hidden && !nm.querySelector(".adm-row")) {
      // 버튼은 [관리자] 하나. 창 안의 [일정]·[참석 체크] 탭으로 오간다.
      // 모임 당일이면 참석 체크부터, 그 밖에는 카드에 보이는 그 모임의 일정부터 연다.
      const row = el("div", "adm-row");
      const b = el("button", "adm-btn", "관리자"); b.type = "button";
      b.onclick = () => (shownDate() === iso(today()) ? openAttendance(shownDate()) : openSchedule(shownIdx()));
      row.append(b); nm.appendChild(row);
    }
    // 모임 결산 카드마다 모임 날짜(data-key)가 붙어 있다. '결제 내역 반영 전' 카드도 같다.
    document.querySelectorAll("#meets article").forEach(a => {
      const att = a.querySelector(".att"), k = a.dataset.key;
      if (!att || !k || att.querySelector(".adm-btn")) return;
      const b = el("button", "adm-btn", "참석 체크"); b.type = "button";
      b.onclick = () => openAttendance(k);
      // 명단이 있으면 맨 아래 오른쪽(휴대폰에서 첫 줄에 넣으면 줄이 넘쳐 요약과 명단 사이가 벌어진다), '미기록'이면 그 옆
      (att.children.length > 1 ? att : att.querySelector(".att-top") || att).appendChild(b);
    });
  }

  /* ── 관리자 창의 [일정]·[참석 체크] 탭과 맨 아래 열쇠 지우기 ── */
  const shownM = () => nextMeeting(R, data.confirmed);          // 정기모임 카드에 지금 보이는 모임
  const shownDate = () => { const M = shownM(); return M && !M.month ? iso(M.dt) : undefined; };   // 달만 정한 일정은 참석 체크할 날짜가 없다
  const shownIdx = () => {
    const M = shownM(), i = M && M.st !== "rule" ? data.confirmed.findIndex(c => c.date === (M.key || iso(M.dt))) : -1;
    return i >= 0 ? i : undefined;
  };
  const tabs = on => '<div class="adm-tabs" role="tablist">'
    + '<button type="button" role="tab" data-t="s"' + (on === "s" ? ' class="on" aria-selected="true"' : '') + '>일정</button>'
    + '<button type="button" role="tab" data-t="a"' + (on === "a" ? ' class="on" aria-selected="true"' : '') + '>참석 체크</button></div>';
  const foot = '<div class="adm-foot"><span>이 버튼들은 이 기기에만 보이고 회원 화면에는 나타나지 않습니다.</span>'
    + '<button type="button">이 기기에서 열쇠 지우기</button></div>';
  // 탭을 누르면 다른 쪽 창으로 바꿔 연다. 날짜·일정은 지금 보고 있던 모임을 따라간다.
  function wire(body, dateForA, idxForS) {
    body.querySelector(".adm-tabs").onclick = e => {
      const b = e.target.closest("button"); if (!b || b.classList.contains("on")) return;
      b.dataset.t === "s" ? openSchedule(idxForS()) : openAttendance(dateForA());
    };
    body.querySelector(".adm-foot button").onclick = () => {
      if (!confirm("이 기기에서 관리자 열쇠를 지울까요?\n다시 쓰려면 사이트 주소 끝에 #admin 을 붙여 열쇠를 새로 넣어야 합니다.")) return;
      try { localStorage.removeItem(KEY); } catch (e) {}
      location.hash = ""; location.reload();
    };
  }

  /* ── 열쇠 연결(새 기기에서 주소#admin 으로 들어왔을 때) ── */
  function openKey(msg) {
    const body = el("div", null,
      (msg ? '<p class="muted" style="color:var(--rust); font-weight:600">' + E(msg) + '</p>' : '')
      + '<p class="muted">저장하려면 GitHub에서 만든 <b>이 사이트 전용 열쇠(토큰)</b>를 이 기기에 한 번 넣어 주세요.</p>'
      + '<ol class="muted" style="padding-left:18px; margin:8px 0 0; line-height:1.7">'
      + '<li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub 열쇠 만들기</a> (로그인 필요)</li>'
      + '<li>Repository access: <b>Only select repositories → icu</b></li>'
      + '<li>Permissions → <b>Contents: Read and write</b> → Generate token</li></ol>'
      + '<label class="k" for="adm-tok">열쇠</label><input id="adm-tok" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_...">'
      + '<div class="adm-btns"><button class="p" id="adm-keysave" type="button">열쇠 연결</button></div>'
      + '<p class="muted" style="margin-top:8px">열쇠는 이 기기 브라우저에만 저장되고 GitHub 말고는 어디에도 보내지 않습니다.</p>');
    sheet("관리자 열쇠 연결", body);
    body.querySelector("#adm-keysave").onclick = async () => {
      const t = body.querySelector("#adm-tok").value.trim();
      if (!t) return toast("열쇠를 붙여 넣어 주세요.", "err");
      toast("열쇠를 확인하는 중…", "info");
      try {
        const r = await fetch(API, { headers: headers(t), cache: "no-store" });
        const j = r.ok ? await r.json() : null;
        if (!j || !j.permissions || !j.permissions.push)
          return toast(r.status === 401 ? "열쇠가 맞지 않습니다. 다시 복사해 붙여 넣어 주세요."
                                        : "이 열쇠로는 icu 저장소에 저장할 수 없습니다. 권한을 확인해 주세요.", "err");
        token = t; try { localStorage.setItem(KEY, t); } catch (e) {}
        close(); await start(); toast("열쇠가 연결됐습니다. 이제 이 화면에서 바로 고칠 수 있습니다.", "ok");
      } catch (e) { toast("GitHub에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.", "err"); }
    };
  }

  /* ── 정기모임 일정 ── */
  function ruleNext(list) {           // 회원 화면과 같은 계산: 이미 정한 분기는 건너뛴 다음 회칙 날짜
    const done = new Set();
    list.forEach(c => { done.add(qkey(firstOf(c))); if (c.replaces) done.add(c.replaces); });
    const t = today();
    for (let k = 0; k < 36; k++) {
      const y = t.getFullYear() + Math.floor((t.getMonth() + k) / 12), m = (t.getMonth() + k) % 12;
      if (R.months.indexOf(m + 1) < 0) continue;
      const first = new Date(y, m, 1);
      const c = new Date(y, m, 1 + ((R.dow - first.getDay() + 7) % 7) + (R.week - 1) * 7);
      if (c >= t && !done.has(qkey(c))) return c;
    }
    return null;
  }

  function openSchedule(editIdx) {
    const list = data.confirmed;
    const ups = list.map((c, i) => ({ c, i })).filter(x => lastOf(x.c) >= today())
      .sort((a, b) => (a.c.date < b.c.date ? -1 : 1));
    const ed = editIdx != null ? list[editIdx] : null;
    const rule = ruleNext(list);
    const body = el("div", null,
      tabs("s")
      + '<p class="muted">' + (ed ? (ed.replaces ? qname(ed.replaces) + " 회칙 날짜를 대신하는 일정입니다." : "")
                             : (rule ? qname(qkey(rule)) + " 회칙 날짜 " + show(rule) + " 대신 정합니다." : "")) + '</p>'
      + '<label class="k">회원 화면 표시</label><div class="adm-seg">'
      + '<label><input type="radio" name="adm-st" value="확정"> 확정</label>'
      + '<label><input type="radio" name="adm-st" value="조율"> 조율 중</label></div>'
      + '<label class="adm-chk"><input type="checkbox" id="adm-monly"> 날짜 미정 — 모이는 달만 정함</label>'
      + '<div class="adm-two"><div><label class="k" id="adm-dlabel" for="adm-date">날짜</label><input id="adm-date" type="date">'
      + '<input id="adm-month" type="month" placeholder="2026-10" hidden></div>'
      + '<div><label class="k" for="adm-time">시간</label><input id="adm-time" type="time"></div></div>'
      + '<p class="muted" id="adm-mhint" style="margin-top:6px" hidden>회원 화면에 ‘10월 중 · 날짜 미정 · 조율 중’으로 보입니다. 시간·장소는 정해졌으면 넣고, 아니면 비워 두세요.</p>'
      + '<label class="k" for="adm-place">장소</label><input id="adm-place" type="text" maxlength="40" placeholder="예) 동인천 향원">'
      + '<label class="k" for="adm-map">지도 링크 (선택)</label><input id="adm-map" type="url" maxlength="500" autocomplete="off" '
      + 'placeholder="네이버 지도 → 공유 → 복사해 붙여 넣기">'
      + '<label class="k" for="adm-note">안내 문구 (선택)</label><input id="adm-note" type="text" maxlength="80" placeholder="비워 두면 확정·조율 중에 맞는 기본 문구">'
      + '<div class="adm-btns"><button class="p" id="adm-save" type="button">' + (ed ? "수정 저장" : "저장") + '</button>'
      + (ed ? '<button class="s" id="adm-new" type="button">새 일정으로</button>' : '') + '</div>'
      + '<label class="k">정해 둔 일정</label>'
      + (ups.length ? '<ul class="adm-list">' + ups.map(x =>
          '<li><span class="dt">' + label(x.c) + ' ' + E(x.c.time) + '</span>' + tag(stOf(x.c))
          + '<span class="pl">' + E(placeText(x.c) || (mapOf(x.c) ? "지도 링크만" : "장소 미정")) + '</span><span class="ac">'
          + '<button type="button" data-e="' + x.i + '">수정</button><button type="button" class="del" data-x="' + x.i + '">삭제</button></span></li>').join("") + '</ul>'
        : '<p class="muted" style="margin-top:6px">아직 없습니다. 회원 화면에는 회칙 날짜가 ‘예정’으로 보입니다.</p>')
      + foot);
    sheet(ed ? "정기모임 일정 수정" : "정기모임 일정 정하기", body);
    wire(body, () => (ed && !isMonth(ed.date) ? ed.date : shownDate()), () => editIdx);
    const f = id => body.querySelector("#" + id);
    const stR = v => body.querySelector('input[name="adm-st"][value="' + v + '"]');
    stR(ed ? stOf(ed) : "확정").checked = true;
    const edM = !!(ed && isMonth(ed.date));
    f("adm-monly").checked = edM;
    f("adm-date").value = ed && !edM ? ed.date : (rule ? iso(rule) : "");
    f("adm-month").value = edM ? ed.date : f("adm-date").value.slice(0, 7);
    f("adm-time").value = ed ? (ed.time || "") : (R.time || "");
    f("adm-place").value = ed ? placeText(ed) : "";
    f("adm-map").value = ed ? mapOf(ed) : "";
    // 네이버 지도 '공유'로 복사한 글([네이버지도] / 이름 / 주소 / 링크)을 붙여 넣으면 링크만 남기고, 장소가 비어 있으면 이름도 채운다
    const onPaste = e => {
      const t = (e.clipboardData && e.clipboardData.getData("text")) || "", u = urlIn(t);
      if (!u || (e.target === f("adm-place") && !/^\s*\[?네이버\s*지도|^\s*https?:/i.test(t))) return;
      e.preventDefault();
      f("adm-map").value = u;
      const lines = t.split(/\r?\n/).map(v => v.trim()).filter(Boolean);
      if (/네이버\s*지도/.test(lines[0] || "") && lines[1] && !urlIn(lines[1]) && (e.target === f("adm-place") || !f("adm-place").value.trim()))
        f("adm-place").value = lines[1].replace(/^\[|\]$/g, "").slice(0, 40);
      toast("지도 링크를 넣었습니다.", "ok");
    };
    f("adm-map").addEventListener("paste", onPaste);
    f("adm-place").addEventListener("paste", onPaste);
    f("adm-note").value = ed ? (ed.note || "") : "";
    if (ed) f("adm-new").onclick = () => openSchedule();

    // 달만 정하면 날짜 대신 달을 고르고, 상태는 조율 중으로 묶는다(날짜 없이 확정할 수는 없다)
    function syncMonth() {
      const on = f("adm-monly").checked;
      f("adm-date").hidden = on; f("adm-month").hidden = !on; f("adm-mhint").hidden = !on;
      f("adm-dlabel").textContent = on ? "모이는 달" : "날짜";
      f("adm-dlabel").htmlFor = on ? "adm-month" : "adm-date";
      stR("확정").disabled = on;
      if (on) stR("조율").checked = true;
    }
    f("adm-monly").onchange = () => {
      if (f("adm-monly").checked && f("adm-date").value) f("adm-month").value = f("adm-date").value.slice(0, 7);
      syncMonth();
    };
    syncMonth();

    f("adm-save").onclick = async () => {
      const monly = f("adm-monly").checked;
      const date = monly ? f("adm-month").value.trim() : f("adm-date").value, time = f("adm-time").value;
      let place = f("adm-place").value.trim(), map = urlIn(f("adm-map").value);
      const note = f("adm-note").value.trim();
      if (!map && urlIn(place)) { map = urlIn(place); place = ""; }          // 장소 칸에 링크를 넣었으면 지도 링크로 옮긴다
      if (f("adm-map").value.trim() && !map) return toast("지도 링크는 https:// 로 시작하는 주소여야 합니다.", "err");
      const status = monly ? "조율" : body.querySelector('input[name="adm-st"]:checked').value;
      if (monly) {
        if (!isMonth(date)) return toast("모이는 달을 골라 주세요 (예: 2026-10).", "err");
        if (date < iso(today()).slice(0, 7)) return toast("지난 달은 정할 수 없습니다.", "err");
      } else {
        if (!date) return toast("날짜를 골라 주세요.", "err");
        if (ymd(date) < today()) return toast("지난 날짜는 정할 수 없습니다.", "err");
      }
      const next = list.slice();
      const entry = { date, time, place, map, note, status, saved: new Date().toISOString() };
      if (ed) { entry.replaces = ed.replaces || ""; next[editIdx] = entry; }
      else { entry.replaces = rule ? qkey(rule) : qkey(firstOf(entry)); next.push(entry); }
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 400);   // 1년 넘은 지난 일정은 정리
      const stName = monly ? "조율 중 · 날짜 미정" : status === "조율" ? "조율 중" : "확정";
      f("adm-save").disabled = true; toast("저장하는 중…", "info");
      const ok = await put(Object.assign({}, data, {
        confirmed: next.filter(c => lastOf(c) >= cutoff).sort((a, b) => (a.date < b.date ? -1 : 1)) }),
        "정기모임 " + stName + ": " + date + (time ? " " + time : "") + (place ? " · " + place : "") + (map ? " · 지도 링크" : ""));
      if (ok) { close(); toast("‘" + stName + "’으로 저장했습니다. 회원 화면에는 1~2분 뒤 반영됩니다.", "ok"); }
      else f("adm-save").disabled = false;
    };
    body.querySelector(".adm-list") && (body.querySelector(".adm-list").onclick = async e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.e) return openSchedule(+b.dataset.e);
      const c = list[+b.dataset.x];
      if (!confirm(label(c) + " 일정을 지울까요?\n날짜·장소가 지워지고 회원 화면은 회칙 날짜(예정)로 돌아갑니다.\n내용을 남기고 표시만 바꾸려면 ‘수정’에서 확정/조율 중을 고르세요.")) return;
      toast("지우는 중…", "info");
      if (await put(Object.assign({}, data, { confirmed: list.filter((_, i) => i !== +b.dataset.x) }), "정기모임 일정 삭제: " + c.date)) {
        close(); toast("지웠습니다. 회원 화면이 회칙 날짜로 돌아갑니다.", "ok");
      }
    });
  }

  /* ── 참석 체크 ── 회원은 순번대로 이름만(직함 없이), 가출 회원은 뺀다. 게스트는 따로, 참석률은 회원만. */
  function candidates() {
    const t = iso(today()), seen = new Set(), out = [];
    data.confirmed.forEach(c => { if (!isMonth(c.date) && c.date <= t) out.push({ d: c.date, p: placeText(c) }); });
    D.meetings.forEach(m => out.push({ d: m.key || m.start, p: m.place || "" }));
    return out.sort((a, b) => (a.d < b.d ? 1 : -1)).filter(x => !seen.has(x.d) && seen.add(x.d)).slice(0, 4);
  }

  function openAttendance(date) {
    const cand = candidates();
    let d = date || (cand[0] ? cand[0].d : iso(today()));
    let present = new Set(), guests = [];
    const pick = dd => {
      d = dd;
      const a = data.attendance[d], m = D.meetings.find(x => (x.key || x.start) === d);
      if (a) { present = new Set(a.present || []); guests = (a.guests || []).slice(); }
      else if (m && m.att) { present = new Set(m.att.present); guests = []; }   // 설정 파일의 옛 기록을 불러와 고칠 수 있게
      else { present = new Set(); guests = []; }
    };
    pick(d);

    const body = el("div", null,
      tabs("a")
      + '<label class="k" for="adm-adate">모임 날짜</label><input id="adm-adate" type="date">'
      + '<div class="adm-chips" id="adm-quick"></div>'
      + '<label class="k">회원 (순번)</label><div class="adm-checks" id="adm-mem"></div>'
      + '<div class="adm-btns"><button class="s" id="adm-all" type="button">모두 참석</button>'
      + '<button class="s" id="adm-none" type="button">모두 해제</button></div>'
      + '<label class="k" for="adm-guest">게스트 (회원 외)</label>'
      + '<div class="adm-grow"><input id="adm-guest" type="text" maxlength="20" placeholder="이름 (모르면 ‘김영민 지인’처럼)">'
      + '<button class="s" id="adm-gadd" type="button">추가</button></div>'
      + '<div class="adm-chips" id="adm-guests"></div>'
      + '<p class="adm-sum" id="adm-sum"></p>'
      + '<div class="adm-btns"><button class="p" id="adm-asave" type="button">참석 저장</button>'
      + '<button class="d" id="adm-adel" type="button">이 날 참석 기록 지우기</button></div>'
      + '<p class="muted" style="margin-top:8px">그 모임의 결제가 은행 거래내역에 들어오면 모임 결산 카드에 붙습니다.</p>'
      + foot);
    sheet("참석 체크", body);
    // [일정] 탭: 지금 고른 날짜에 정해 둔 일정이 있으면 그 일정, 없으면 카드에 보이는 모임
    wire(body, () => d, () => { const i = data.confirmed.findIndex(c => c.date === d); return i >= 0 ? i : shownIdx(); });
    const f = id => body.querySelector("#" + id);

    function draw() {
      f("adm-adate").value = d;
      f("adm-quick").innerHTML = cand.map(c => '<button type="button" data-d="' + c.d + '"' + (c.d === d ? ' class="on"' : '') + '>'
        + show(ymd(c.d)) + (c.p ? " " + E(c.p) : "") + '</button>').join("");
      const act = ACTIVE();
      f("adm-mem").innerHTML = act.map(m => '<button type="button" data-n="' + E(m.name) + '" aria-pressed="' + present.has(m.name) + '">'
        + '<span class="no">' + m.no + '</span>' + E(m.name) + '</button>').join("");
      f("adm-guests").innerHTML = guests.map((g, i) => '<button type="button" class="guest" data-g="' + i + '">' + E(g) + ' ✕</button>').join("");
      const n = act.filter(m => present.has(m.name)).length, r = Math.round(n / act.length * 1000) / 10;
      f("adm-sum").innerHTML = show(ymd(d)) + ' · <span class="yes">참석 ' + n + '명</span>'
        + (guests.length ? ' · <span class="yes">게스트 ' + guests.length + '명</span>' : '')
        + ' · <span class="no">미참석 ' + (act.length - n) + '명</span>'
        + ' · <span class="rate ' + (r >= 100 ? "full" : r >= 50 ? "mid" : "") + '">참석률 ' + r.toFixed(1) + '%</span>';
      f("adm-adel").hidden = !data.attendance[d];
    }
    draw();

    f("adm-adate").onchange = () => { if (f("adm-adate").value) { pick(f("adm-adate").value); draw(); } };
    f("adm-quick").onclick = e => { const b = e.target.closest("button"); if (b) { pick(b.dataset.d); draw(); } };
    f("adm-mem").onclick = e => { const b = e.target.closest("button"); if (!b) return;
      present.has(b.dataset.n) ? present.delete(b.dataset.n) : present.add(b.dataset.n); draw(); };
    f("adm-all").onclick = () => { ACTIVE().forEach(m => present.add(m.name)); draw(); };
    f("adm-none").onclick = () => { present.clear(); draw(); };
    f("adm-gadd").onclick = () => {
      const g = f("adm-guest").value.trim(); if (!g) return;
      if (ACTIVE().some(m => m.name === g)) return toast(g + " 님은 회원입니다. 위 회원 목록에서 눌러 주세요.", "err");
      if (guests.indexOf(g) < 0) guests.push(g);
      f("adm-guest").value = ""; draw();
    };
    f("adm-guest").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); f("adm-gadd").click(); } };
    f("adm-guests").onclick = e => { const b = e.target.closest("button"); if (b) { guests.splice(+b.dataset.g, 1); draw(); } };

    f("adm-asave").onclick = async () => {
      if (ymd(d) > today()) return toast("아직 오지 않은 날짜는 참석 체크할 수 없습니다.", "err");
      const names = ACTIVE().filter(m => present.has(m.name)).map(m => m.name);
      const A = Object.assign({}, data.attendance);
      A[d] = { present: names, guests: guests.slice(), saved: new Date().toISOString() };
      f("adm-asave").disabled = true; toast("저장하는 중…", "info");
      const ok = await put(Object.assign({}, data, { attendance: A }),
        "참석 체크: " + d + " · 참석 " + names.length + "명" + (guests.length ? " + 게스트 " + guests.length + "명" : ""));
      if (ok) { close(); toast(show(ymd(d)) + " 참석을 저장했습니다. 회원 화면에는 1~2분 뒤 반영됩니다.", "ok"); }
      else f("adm-asave").disabled = false;
    };
    f("adm-adel").onclick = async () => {
      if (!confirm(show(ymd(d)) + " 참석 기록을 지울까요?")) return;
      const A = Object.assign({}, data.attendance); delete A[d];
      if (await put(Object.assign({}, data, { attendance: A }), "참석 기록 삭제: " + d)) { close(); toast("참석 기록을 지웠습니다.", "ok"); }
    };
  }

  /* ── 시작 ── */
  async function start() {
    try { await load(); }
    catch (e) {
      if (e.message === "401") { try { localStorage.removeItem(KEY); } catch (x) {} token = ""; return openKey("열쇠가 맞지 않거나 기한이 지났습니다. 새로 연결해 주세요."); }
      toast("관리 정보를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.", "err");
      return;
    }
    repaint();
    // 회원 화면이 meeting.json 을 늦게 받아 다시 그리면 버튼이 사라지므로 다시 단다
    ["nextmeet", "meets"].forEach(id => {
      const t = document.getElementById(id);
      if (t) new MutationObserver(() => decorate()).observe(t, { childList: true });
    });
    if (location.hash === "#admin") history.replaceState(null, "", location.pathname + location.search);
  }

  if (token) start(); else openKey();
  // 열쇠 연결 창을 닫았다가 ICU 표지 5번 누르기(#admin)로 다시 부른 경우
  window.addEventListener("hashchange", () => { if (location.hash === "#admin" && !token) openKey(); });
})();
