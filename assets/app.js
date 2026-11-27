/* =====================================================================
 * app.js — 감사처분심의위원회 결과보고서 자동화 (1차 파일럿)
 *  - 4단계 상태 관리 · 자동 합산 · 시효 계산 · 근거 검색 · 미리보기 · HWPX
 *  - 서버 없음. 모든 값은 이 브라우저(localStorage)에만 남는다.
 * ===================================================================== */
(function () {
  'use strict';

  var STORAGE_KEY = 'audit-report-app.v1';
  var KIND_META = {
    '변상': { col: '변상', unit: 'money' },
    '징계': { col: '징계', unit: 'people' },
    '환수': { col: '환수', unit: 'money' },
    '주의': { col: '주의·경고', unit: 'people' },
    '경고': { col: '주의·경고', unit: 'people' },
    '개선': { col: '개선', unit: 'none' },
    '권고': { col: '권고', unit: 'none' },
    '통보': { col: '통보', unit: 'none' },
    '고발': { col: '고발', unit: 'people' },
    '모범사례': { col: '모범사례', unit: 'people' }
  };
  var COL_ORDER = ['변상', '징계', '환수', '주의·경고', '개선', '권고', '통보', '고발', '모범사례'];

  /* ---------------- helpers ---------------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }
  function fmt(n) {
    var v = Number(n || 0);
    if (!v) return '0';
    return v.toLocaleString('ko-KR');
  }
  function fmtDate(iso) {
    if (!iso) return '';
    var p = String(iso).split('-');
    if (p.length !== 3) return iso;
    return Number(p[0]) + '. ' + Number(p[1]) + '. ' + Number(p[2]) + '.';
  }
  function localDate(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }
  function lines(s) {
    return String(s || '').split('\n').map(function (x) { return x.trim(); }).filter(function (x) { return x.length; });
  }
  function firstLine(s) { return lines(s)[0] || ''; }
  function uid() { return 'i' + Math.random().toString(36).slice(2, 8); }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2600);
  }

  /* ---------------- state ---------------- */
  function newKind() { return { key: '징계', n: 1, people: 1, amount: 0, note: '' }; }
  function newSubject() {
    return { org: '', rank: '', name: '', duty: '', period: '', req: '', points: '' };
  }
  function newItem(title) {
    return {
      id: uid(), title: title || '', dept: '',
      kinds: [{ key: '징계', n: 1, people: 1, amount: 0, note: '' }],
      b1: '', b2: '', b3: '', b4: '', b5: '',
      subjects: [], evidences: [], picks: []
    };
  }
  function blankState() {
    return {
      step: 1,
      meta: {
        round: '', reportDate: '', docTitle: '', orgName: '한국생산기술연구원',
        auditName: '', dept: '', occurredAt: '', awareAt: '', fiveYear: false,
        resType: '원안 의결', resText: ''
      },
      items: [newItem()],
      active: 0,
      evidIdx: 0,
      _hydrated: null
    };
  }

  var state = blankState();

  function save() {
    try {
      var copy = JSON.parse(JSON.stringify(state));
      delete copy._hydrated;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(copy));
    } catch (e) { /* 저장 실패는 조용히 무시 */ }
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      var s = JSON.parse(raw);
      if (!s || !s.meta || !Array.isArray(s.items) || !s.items.length) return false;
      state = Object.assign(blankState(), s);
      state._hydrated = null;
      return true;
    } catch (e) { return false; }
  }

  /* ---------------- 계산 ---------------- */
  function aggregate() {
    var cols = {};
    COL_ORDER.forEach(function (c) { cols[c] = { n: 0, money: 0, people: 0 }; });
    var count = 0, people = 0, money = 0;
    state.items.forEach(function (it) {
      (it.kinds || []).forEach(function (k) {
        var m = KIND_META[k.key];
        if (!m) return;
        var c = cols[m.col];
        c.n += Number(k.n) || 1;
        count += Number(k.n) || 1;
        if (m.unit === 'money' && Number(k.amount)) {
          c.money += Number(k.amount); money += Number(k.amount);
        }
        if (m.unit === 'people' && Number(k.people)) {
          c.people += Number(k.people); people += Number(k.people);
        }
      });
    });
    return { cols: cols, count: count, people: people, money: money };
  }

  function cellVal(c) {
    if (!c.n) return '-';
    if (c.money) return c.n + '(' + fmt(c.money) + ')';
    if (c.people) return c.n + '(' + c.people + ')';
    return String(c.n);
  }

  function kindAmountText(it) {
    var rows = (it.kinds || []).map(function (k) {
      var m = KIND_META[k.key] || { unit: 'none' };
      if (m.unit === 'money') return fmt(k.amount) + '원';
      if (m.unit === 'people') return k.key + '(' + (Number(k.people) || 0) + ')';
      return k.key + '(' + (Number(k.n) || 1) + ')';
    }).filter(Boolean);
    return rows.length ? rows.join('\n') : '-';
  }

  function kindNames(it) {
    return (it.kinds || []).map(function (k) {
      return k.key + (k.note ? '(' + k.note + ')' : '');
    }).join('\n');
  }

  function reqHeading(it) {
    var names = [];
    (it.kinds || []).forEach(function (k) { if (names.indexOf(k.key) < 0) names.push(k.key); });
    if (!names.length) return '처분요구';
    var notify = names.filter(function (n) { return ['통보', '개선', '권고'].indexOf(n) >= 0; });
    var demand = names.filter(function (n) { return ['통보', '개선', '권고'].indexOf(n) < 0; });
    var head = demand.length ? demand.join(' ․ ') + ' 요구' : '';
    if (notify.length) head += (head ? ' 및 ' : '') + '통보';
    return head || '처분요구';
  }

  function statute() {
    var m = state.meta;
    if (!m.occurredAt) return null;
    var o = new Date(m.occurredAt + 'T00:00:00');
    if (isNaN(o.getTime())) return null;
    var years = m.fiveYear ? 5 : 3;
    var exp = new Date(o.getTime());
    exp.setFullYear(exp.getFullYear() + years);
    exp.setDate(exp.getDate() - 1);
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var remain = Math.round((exp - today) / 86400000);
    var awareDays = m.awareAt ? Math.round((new Date(m.awareAt + 'T00:00:00') - o) / 86400000) : null;
    var awareLate = m.awareAt ? new Date(m.awareAt + 'T00:00:00') > exp : false;
    var stateTxt = remain < 0 ? 'bad' : (remain <= 90 ? 'warn' : 'ok');
    var label = remain < 0 ? ('시효 경과 · ' + fmt(-remain) + '일 지남')
      : (remain <= 90 ? ('시효 임박 · D-' + remain) : ('유효 · D-' + remain));
    return { years: years, expiry: exp, remain: remain, status: stateTxt, label: label, awareDays: awareDays, awareLate: awareLate };
  }

  function blockStatus(it) {
    return [
      { k: '① 제목', ok: !!(it.b1 || it.title), v: it.b1 || it.title },
      { k: '② 경위', ok: !!lines(it.b2).length, v: it.b2 },
      { k: '③ 사실관계', ok: !!lines(it.b4).length, v: it.b4 },
      { k: '④ 판단·법령', ok: !!lines(it.b3).length || (it.picks || []).length > 0, v: it.b3 },
      { k: '⑤ 처분요구', ok: !!lines(it.b5).length, v: it.b5 }
    ];
  }

  function citeLines(it) {
    return (it.picks || []).map(function (p) {
      if (p.type === 'case') return '○ 참고 사례 [' + p.id + '] ' + p.title + (p.statute ? ' — ' + p.statute : '');
      return '○ ' + p.reg + ' ' + p.article + ': ' + p.summary;
    });
  }
  function citeAnnex(it) {
    return (it.picks || []).map(function (p) {
      if (p.type === 'case') return '[사례 ' + p.id + '] ' + p.title + (p.authority ? ' (' + p.authority + ')' : '');
      return '「' + p.reg + '」 ' + p.article + ' — ' + p.summary;
    });
  }

  function evidRows(it) {
    return (it.evidences || []).filter(function (e) {
      return [e.date, e.title, e.body, e.amount, e.note].some(function (v) { return String(v || '').trim().length; });
    });
  }

  function subjectRows() {
    var rows = [];
    state.items.forEach(function (it) {
      if (!(it.subjects || []).length) {
        rows.push({ ORG: firstLine(it.dept) || state.meta.dept || '-', PERSON: '-', POINTS: 'ㅇ ' + (it.title || state.meta.docTitle || '-') });
        return;
      }
      it.subjects.forEach(function (s) {
        var pts = lines(s.points).map(function (l) { return /^[ㅇ○\-]/.test(l) ? l : 'ㅇ ' + l; }).join('\n');
        rows.push({
          ORG: s.org || firstLine(it.dept) || state.meta.dept || '-',
          PERSON: (s.name || '') + (s.rank ? ' ' + s.rank : ''),
          POINTS: pts || 'ㅇ -'
        });
      });
    });
    return rows;
  }

  /* ---------------- 화면: 공통 ---------------- */
  function goStep(n, skipRead) {
    if (!skipRead) readForms();
    state.step = n;
    [1, 2, 3, 4].forEach(function (i) {
      $('step' + i).hidden = i !== n;
    });
    Array.prototype.forEach.call(document.querySelectorAll('.step'), function (b) {
      var s = Number(b.dataset.step);
      b.classList.toggle('is-active', s === n);
      b.classList.toggle('is-done', s < n);
    });
    if (n === 2) { hydrateItem(); renderItemLists(); }
    if (n === 3) { renderEvidSelect(); renderEvidTable(); }
    if (n === 4) { renderPreview(); renderSum(); fillFileName(); }
    renderSidebar();
    save();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderSidebar() {
    var agg = aggregate();
    var total = state.items.length;
    var filled = state.items.reduce(function (a, it) {
      return a + blockStatus(it).filter(function (b) { return b.ok; }).length;
    }, 0);
    var max = total * 5;
    var st = statute();

    var html = '';
    html += '<div class="prow"><span>처분요구 건</span><strong>' + agg.count + '건 / ' + total + '묶음</strong></div>';
    html += '<div class="prow"><span>5단 블록</span><strong>' + filled + ' / ' + max + '</strong></div>';
    html += '<div class="pbar"><i style="width:' + (max ? Math.round(filled / max * 100) : 0) + '%"></i></div>';
    html += '<div class="prow"><span>담은 근거</span><strong>' + state.items.reduce(function (a, it) { return a + (it.picks || []).length; }, 0) + '건</strong></div>';
    $('progressBox').innerHTML = html;

    var act = state.items[state.active] || state.items[0];
    var list = '';
    blockStatus(act).forEach(function (b) {
      list += '<li class="' + (b.ok ? 'ok' : '') + '"><span class="dot">' + (b.ok ? '✓' : '') + '</span>' + esc(b.k) + '</li>';
    });
    if (total > 1) list += '<li class="meta" style="display:block;color:#6b7a94">· 지금은 ' + (state.active + 1) + '번째 건 기준</li>';
    $('blockChecklist').innerHTML = list;

    var sb = '';
    if (!st) {
      sb = '<span class="badge none">행위 발생일 미입력</span><p class="statute-note">발생일을 넣으면 3년(5년 특례) 시효 만료일과 잔여일을 계산합니다.</p>';
    } else {
      sb += '<span class="badge ' + st.status + '">' + esc(st.label) + '</span>';
      sb += '<dl><dt>기준</dt><dd>' + st.years + '년 (' + (st.years === 5 ? '특례' : '일반') + ')</dd>';
      sb += '<dt>만료 예정</dt><dd>' + fmtDate(localDate(st.expiry)) + '</dd>';
      if (st.awareDays != null) sb += '<dt>발생~인지</dt><dd>' + fmt(st.awareDays) + '일</dd></dl>';
      if (st.awareLate) sb += '<p class="statute-note" style="color:#b42318">인지 시점에 이미 시효가 만료된 구간입니다. 중단·정지 사유를 확인하세요.</p>';
      sb += '<p class="statute-note">참고값입니다. 형사·징계절차에 따른 중단·정지, 구법·신법 부칙은 감사인이 확인합니다.</p>';
    }
    $('statuteBox').innerHTML = sb;

    var inline = $('statuteInline');
    if (inline) {
      inline.innerHTML = st
        ? '<strong>' + esc(st.label) + '</strong> · 만료 ' + fmtDate(localDate(st.expiry)) +
          ' · ' + st.years + '년 기준' + (st.awareLate ? ' · <span style="color:#b42318">인지 시점 시효 경과</span>' : '')
        : '행위 발생일을 넣으면 징계·문책 시효(3년/5년)를 계산합니다.';
    }
  }

  /* ---------------- 1단계 ---------------- */
  var META_BIND = {
    'f-round': 'round', 'f-reportDate': 'reportDate', 'f-docTitle': 'docTitle',
    'f-orgName': 'orgName', 'f-dept': 'dept', 'f-auditName': 'auditName',
    'f-occurredAt': 'occurredAt', 'f-awareAt': 'awareAt', 'f-resType': 'resType', 'f-resText': 'resText'
  };
  var ITEM_BIND = {
    'i-title': 'title', 'i-dept': 'dept', 'i-b1': 'b1', 'i-b2': 'b2', 'i-b3': 'b3', 'i-b4': 'b4', 'i-b5': 'b5'
  };

  function hydrateMeta() {
    Object.keys(META_BIND).forEach(function (id) {
      var el = $(id); if (!el) return;
      el.value = state.meta[META_BIND[id]] || '';
    });
    $('f-fiveYear').checked = !!state.meta.fiveYear;
  }

  function hydrateItem() {
    var it = state.items[state.active];
    if (!it) return;
    Object.keys(ITEM_BIND).forEach(function (id) {
      var el = $(id); if (!el) return;
      el.value = it[ITEM_BIND[id]] || '';
    });
    state._hydrated = it.id;
    renderKinds();
    renderSubjects();
    renderPicked();
    renderSearch();
  }

  function readForms() {
    Object.keys(META_BIND).forEach(function (id) {
      var el = $(id); if (!el) return;
      state.meta[META_BIND[id]] = el.value;
    });
    state.meta.fiveYear = $('f-fiveYear').checked;
    var it = state.items[state.active];
    if (it && state._hydrated === it.id) {
      Object.keys(ITEM_BIND).forEach(function (id) {
        var el = $(id); if (!el) return;
        it[ITEM_BIND[id]] = el.value;
      });
    }
  }

  /* ---------------- 2단계: 건/종류/대상자 ---------------- */
  function renderItemLists() {
    var tabs = state.items.map(function (it, i) {
      var name = it.title || ('건 ' + (i + 1));
      return '<div class="item-tab' + (i === state.active ? ' is-active' : '') + '" data-idx="' + i + '" role="tab" tabindex="0">' +
        '<span class="nm">' + (i + 1) + '. ' + esc(name) + '</span>' +
        (state.items.length > 1 ? '<button class="x" data-del="' + i + '" type="button" aria-label="삭제">✕</button>' : '') +
        '</div>';
    }).join('');
    $('itemTabs').innerHTML = tabs;
    $('step2Hint').textContent = state.items.length + '건 · 5단 블록 ' +
      state.items.reduce(function (a, it) { return a + blockStatus(it).filter(function (b) { return b.ok; }).length; }, 0) + '/' + (state.items.length * 5);
  }

  function renderKinds() {
    var it = state.items[state.active];
    var body = $('kindBody');
    if (!it) { body.innerHTML = ''; return; }
    var rows = it.kinds.map(function (k, i) {
      var m = KIND_META[k.key] || { unit: 'none' };
      var opts = Object.keys(KIND_META).map(function (key) {
        return '<option value="' + key + '"' + (key === k.key ? ' selected' : '') + '>' + key + '</option>';
      }).join('');
      var amt = m.unit === 'money'
        ? '<input type="number" min="0" step="1" data-k="amount" data-i="' + i + '" value="' + (k.amount || '') + '" placeholder="0" inputmode="numeric">'
        : '<input type="number" min="0" step="1" data-k="amount" data-i="' + i + '" value="" placeholder="—" disabled>';
      var ppl = m.unit === 'people'
        ? '<input type="number" min="1" step="1" data-k="people" data-i="' + i + '" value="' + (k.people || '') + '" placeholder="1" inputmode="numeric">'
        : '<input type="number" min="0" step="1" data-k="people" data-i="' + i + '" value="" placeholder="—" disabled>';
      return '<tr>' +
        '<td><select data-k="key" data-i="' + i + '">' + opts + '</select></td>' +
        '<td class="n"><input type="number" min="1" step="1" data-k="n" data-i="' + i + '" value="' + (k.n || 1) + '" inputmode="numeric"></td>' +
        '<td class="n">' + ppl + '</td>' +
        '<td class="a">' + amt + '</td>' +
        '<td class="note"><input type="text" data-k="note" data-i="' + i + '" value="' + esc(k.note || '') + '" placeholder="예: 시정완료" autocomplete="off"></td>' +
        '<td class="act"><button class="row-del" data-delkind="' + i + '" type="button" aria-label="종류 삭제">✕</button></td>' +
        '</tr>';
    }).join('');
    body.innerHTML = rows || '<tr><td colspan="6" class="hint">종류를 추가해 주세요.</td></tr>';
    $('blockMeta').textContent = '5단 블록 ' + blockStatus(it).filter(function (b) { return b.ok; }).length + '/5';
  }

  function renderSubjects() {
    var it = state.items[state.active];
    var box = $('subjectList');
    if (!it) { box.innerHTML = ''; return; }
    if (!it.subjects.length) {
      box.innerHTML = '<p class="empty">대상자를 비워 두면 지적사항 요약에 건 제목이 대신 들어갑니다. 인원·이름이 있으면 추가해 주세요.</p>';
      return;
    }
    box.innerHTML = it.subjects.map(function (s, i) {
      return '<div class="subject-card" data-si="' + i + '">' +
        '<div class="subject-head"><span>대상자 ' + (i + 1) + '</span>' +
        '<button class="row-del" data-delsub="' + i + '" type="button" aria-label="삭제">✕</button></div>' +
        '<div class="subject-grid">' +
        fld('소속', 'org', s.org, i) + fld('직급', 'rank', s.rank, i) + fld('성명', 'name', s.name, i) +
        fld('직무', 'duty', s.duty, i) + fld('담당기간', 'period', s.period, i) + fld('처분요구', 'req', s.req, i) +
        '<label class="field wide"><span>주요 지적사항 <small>줄바꿈으로 여러 개</small></span>' +
        '<textarea rows="2" data-sk="points" data-i="' + i + '" placeholder="예: 허위 증빙으로 여비 1,250,000원을 수령">' + esc(s.points || '') + '</textarea></label>' +
        '</div></div>';
    }).join('');

    function fld(label, key, val, i) {
      return '<label class="field"><span>' + label + '</span>' +
        '<input type="text" data-sk="' + key + '" data-i="' + i + '" value="' + esc(val || '') + '" autocomplete="off"></label>';
    }
  }

  /* ---------------- 근거 검색 ---------------- */
  var searchState = { src: 'cases', q: '', cat: '' };

  function renderChips() {
    var cats = ['', '연구비', '복무', '인사', '계약', '자산·물품', '윤리', '정보보안'];
    var exist = {};
    (window.AUDIT_CASES || []).forEach(function (c) { exist[c.category] = 1; });
    var list = Object.keys(exist);
    list.sort();
    var html = ''.concat('<button class="chip' + (searchState.cat === '' ? ' is-active' : '') + '" data-cat="" type="button">전체</button>');
    list.forEach(function (c) {
      html += '<button class="chip' + (searchState.cat === c ? ' is-active' : '') + '" data-cat="' + esc(c) + '" type="button">' + esc(c) + '</button>';
    });
    $('caseChips').innerHTML = searchState.src === 'cases' ? html : '';
  }

  function caseMatches(c, q) {
    if (!q) return true;
    var hay = [c.title, c.dilemma, c.statute, c.authority, c.rationale, c.facts, c.category, c.status].join(' ');
    return q.split(/\s+/).every(function (w) { return hay.toLowerCase().indexOf(w.toLowerCase()) >= 0; });
  }

  function renderSearch() {
    var it = state.items[state.active];
    renderChips();
    var q = searchState.q.trim();
    var box = $('evResults');
    if (!it) { box.innerHTML = ''; return; }
    if (searchState.src === 'cases') {
      var cases = (window.AUDIT_CASES || []).filter(function (c) {
        return (!searchState.cat || c.category === searchState.cat) && caseMatches(c, q);
      });
      var shown = cases.slice(0, 24);
      $('pickedMeta').textContent = '사례 ' + (window.AUDIT_CASES || []).length + '건 · 규정 ' + (window.AUDIT_REGS || []).length + '개 조문';
      if (!shown.length) {
        box.innerHTML = '<p class="empty">검색 결과가 없습니다. 검색어를 바꾸거나 근거 없이 진행해 주세요.</p>';
        return;
      }
      box.innerHTML = shown.map(function (c) {
        var picked = it.picks.some(function (p) { return p.type === 'case' && p.id === c.id; });
        return '<article class="res">' +
          '<div class="res-top"><span class="res-id">' + esc(c.id) + '</span>' +
          '<span class="res-title">' + esc(c.title) + '</span>' +
          '<span class="badge-tier t' + esc(c.tier || 1) + '">Tier ' + esc(c.tier || 1) + '</span></div>' +
          '<div class="res-meta">' + esc(c.category || '') + ' · ' + esc(c.status || '') + ' · ' + esc(c.statute || c.regulation || '') + '</div>' +
          '<div class="res-body">' + esc(c.rationale || c.facts || '') + '</div>' +
          '<div class="res-acts"><button class="btn sm" data-pick="case" data-id="' + esc(c.id) + '" type="button"' + (picked ? ' disabled' : '') + '>' + (picked ? '담김' : '근거 담기') + '</button>' +
          '<button class="btn ghost sm" data-detail="' + esc(c.id) + '" type="button">원문 보기</button></div>' +
          '<div class="res-detail" hidden data-detailbox="' + esc(c.id) + '"></div>' +
          '</article>';
      }).join('');
    } else {
      var regs = (window.AUDIT_REGS || []).filter(function (r) {
        if (!q) return true;
        return (r.reg + ' ' + r.article + ' ' + r.summary).toLowerCase().indexOf(q.toLowerCase()) >= 0;
      }).slice(0, 40);
      if (!regs.length) {
        box.innerHTML = '<p class="empty">해당 조문이 없습니다. 다른 키워드로 찾아보세요.</p>';
        return;
      }
      box.innerHTML = regs.map(function (r, i) {
        var picked = it.picks.some(function (p) { return p.type === 'reg' && p.reg === r.reg && p.article === r.article; });
        return '<article class="res">' +
          '<div class="res-top"><span class="res-id">규정</span><span class="res-title">' + esc(r.reg) + ' ' + esc(r.article) + '</span></div>' +
          '<div class="res-meta">' + esc(r.summary) + '</div>' +
          '<div class="res-acts"><button class="btn sm" data-pick="reg" data-ri="' + i + '" type="button"' + (picked ? ' disabled' : '') + '>' + (picked ? '담김' : '근거 담기') + '</button></div>' +
          '</article>';
      }).join('');
      $('regIndexCache') ; // no-op
      window.__regShown = regs;
    }
  }

  function renderPicked() {
    var it = state.items[state.active];
    if (!it) return;
    $('pickedCount').textContent = it.picks.length;
    $('pickedList').innerHTML = it.picks.length ? it.picks.map(function (p, i) {
      var label = p.type === 'case' ? '사례 ' + p.id : '규정';
      var text = p.type === 'case' ? p.title + ' — ' + (p.statute || '') : p.reg + ' ' + p.article + ': ' + p.summary;
      return '<li><span class="p-kind">' + esc(label) + '</span><span class="p-txt">' + esc(text) + '</span>' +
        '<button class="row-del" data-unpick="' + i + '" type="button" aria-label="빼기">✕</button></li>';
    }).join('') : '<li class="hint" style="border:0;background:transparent">아직 담은 근거가 없습니다. 담지 않으면 문서에 조문이 생기지 않습니다.</li>';
    $('blockMeta').textContent = '5단 블록 ' + blockStatus(it).filter(function (b) { return b.ok; }).length + '/5';
  }

  /* ---------------- 3단계: 증빙 ---------------- */
  function curEvidItem() {
    if (!state.items[state.evidIdx]) state.evidIdx = 0;
    return state.items[state.evidIdx];
  }
  function renderEvidSelect() {
    $('evidItemSelect').innerHTML = state.items.map(function (it, i) {
      return '<option value="' + i + '"' + (i === state.evidIdx ? ' selected' : '') + '>' + (i + 1) + '. ' + esc(it.title || '건 ' + (i + 1)) + '</option>';
    }).join('');
  }
  function renderEvidTable() {
    var it = curEvidItem();
    var body = $('evidBody');
    if (!it) return;
    body.innerHTML = (it.evidences.length ? it.evidences.map(function (e, i) {
      return '<tr>' +
        '<td class="act">' + (i + 1) + '</td>' +
        '<td><input type="text" data-ek="date" data-i="' + i + '" value="' + esc(e.date || '') + '" placeholder="2026-09-12"></td>' +
        '<td><input type="text" data-ek="title" data-i="' + i + '" value="' + esc(e.title || '') + '" placeholder="출장명령서"></td>' +
        '<td><input type="text" data-ek="body" data-i="' + i + '" value="' + esc(e.body || '') + '" placeholder="2박 3일 국내출장"></td>' +
        '<td><input type="text" data-ek="amount" data-i="' + i + '" value="' + esc(e.amount || '') + '" placeholder="250,000" inputmode="numeric"></td>' +
        '<td><input type="text" data-ek="note" data-i="' + i + '" value="' + esc(e.note || '') + '" placeholder="승인번호 1234"></td>' +
        '<td class="act"><button class="row-del" data-delevid="' + i + '" type="button" aria-label="행 삭제">✕</button></td>' +
        '</tr>';
    }).join('') : '<tr><td colspan="7" class="hint">행이 없습니다. 비워 두면 문서에 증빙표가 나가지 않습니다.</td></tr>');
    $('evidMeta').textContent = it.evidences.length + '행 · ' + (it.title || '건 ' + (state.evidIdx + 1));
    $('step3Hint').textContent = it.evidences.length ? it.evidences.length + '행이 [표] 세부 증빙 내역으로 들어갑니다.' : '증빙표를 비우면 표 없이 나갑니다.';
  }

  /* ---------------- 4단계: 요약/미리보기 ---------------- */
  function renderSum() {
    var a = aggregate();
    var st = statute();
    var html = '';
    html += card('처분요구 건수', a.count + '건');
    html += card('신분상 조치 인원', a.people + '명');
    html += card('재정상 조치 금액', fmt(a.money) + '원');
    html += card('징계 시효', st ? st.label : '미계산');
    $('sumBox').innerHTML = html;
    function card(k, v) { return '<div class="sum-card"><div class="k">' + k + '</div><div class="v">' + esc(v) + '</div></div>'; }
  }

  function renderPreview() {
    readForms();
    var m = state.meta;
    var a = aggregate();
    var head = docHeading();
    var p = [];
    /* 표지 */
    p.push('<div class="doc-page">');
    p.push('<div class="doc-title-box"><div class="t1">' + esc(head) + '</div><div class="t2">- ' + esc(m.docTitle || '제목 미입력') + ' -</div></div>');
    p.push('<div class="cover-date">' + esc(fmtDate(m.reportDate) || '보고일 미입력') + '</div>');
    p.push('<div class="cover-org"><div>' + esc(m.orgName || '') + '</div><div class="big">감 사 부</div></div>');
    p.push('</div>');

    /* 총괄·일람표·지적사항·의결 */
    p.push('<div class="doc-page">');
    p.push('<h4 class="sec">1. 총괄</h4>');
    p.push('<div class="table-scroll"><table class="cols-12"><thead><tr>');
    p.push('<th rowspan="2" colspan="3">합계</th>');
    ['변상<br>(금액)', '징계<br>(인원)', '환수<br>(금액)', '주의․경고<br>(인원)', '개선', '권고', '통보', '고발<br>(인원)', '모범사례<br>(인원)'].forEach(function (h) { p.push('<th rowspan="2">' + h + '</th>'); });
    p.push('</tr><tr></tr></thead><tbody>');
    p.push('<tr><td>처분요구건수</td><td>신분상조치인원</td><td>재정상조치금액</td>');
    COL_ORDER.forEach(function (c) { p.push('<td>' + esc(cellVal(a.cols[c])) + '</td>'); });
    p.push('</tr><tr><td>' + a.count + '</td><td>' + a.people + '</td><td>' + fmt(a.money) + '</td>');
    COL_ORDER.forEach(function (c) { p.push('<td></td>'); });
    p.push('</tr></tbody></table></div>');

    p.push('<h4 class="sec">2. 일람표</h4>');
    p.push('<div class="table-scroll"><table><thead><tr><th style="width:8%">연번</th><th style="width:24%">관 계 부 서</th><th style="width:16%">처분요구종 류</th><th>제 목</th><th style="width:18%">금 액(인원)</th></tr></thead><tbody>');
    if (!state.items.length) p.push('<tr><td colspan="5">건이 없습니다.</td></tr>');
    state.items.forEach(function (it, i) {
      p.push('<tr><td>' + (i + 1) + '</td><td>' + nl2br(it.dept || m.dept || '') + '</td><td>' + nl2br(kindNames(it) || '-') + '</td>' +
        '<td class="l">ㅇ ' + esc(it.title || m.docTitle || '') + '</td><td>' + nl2br(kindAmountText(it)) + '</td></tr>');
    });
    p.push('</tbody></table></div>');

    p.push('<h4 class="sec">3. 지적사항 요약</h4>');
    p.push('<div class="table-scroll"><table><thead><tr><th style="width:18%">소속</th><th style="width:20%">대상자(**)</th><th>주요 지적사항</th></tr></thead><tbody>');
    subjectRows().forEach(function (r) {
      p.push('<tr><td>' + nl2br(r.ORG) + '</td><td>' + nl2br(r.PERSON) + '</td><td class="l">' + nl2br(r.POINTS) + '</td></tr>');
    });
    p.push('</tbody></table></div>');

    p.push('<h4 class="sec">4. 의결사항 : ' + esc(m.resType || '') + '</h4>');
    p.push('<p>- ' + esc(m.resText || '의결 내용 미입력') + '</p>');
    p.push('<h4 class="sec">5. 처분요구(안) : 붙임</h4>');
    p.push('</div>');

    /* 붙임1 (건별) */
    state.items.forEach(function (it, i) {
      var label = state.items.length > 1 ? ('붙임 1-' + (i + 1)) : '붙임 1';
      p.push('<div class="doc-page">');
      p.push('<div class="annex-head"><div class="annex-label">' + esc(label.replace('붙임 ', '붙임<br>')) + '</div><div class="annex-title">감사결과 처분요구 (' + esc(it.title || m.docTitle || '') + ')</div></div>');
      p.push('<p class="center doc-h">' + esc(reqHeading(it)) + '</p>');
      p.push('<div class="kv"><div class="k">제 목</div><div class="v">' + esc(it.b1 || it.title || '') + '</div></div>');
      p.push('<div class="kv"><div class="k">내 용</div><div class="v"></div></div>');
      p.push('<h4 class="sec">1. 사건 개요</h4>');
      lines(it.b2).forEach(function (l) { p.push('<p>' + esc(l) + '</p>'); });
      p.push('<h4 class="sec">2. 관계 규정 및 판단기준</h4>');
      lines(it.b3).forEach(function (l) { p.push('<p>' + esc(l) + '</p>'); });
      citeLines(it).forEach(function (l) { p.push('<p>' + esc(l) + '</p>'); });
      p.push('<h4 class="sec">3. 감사결과 확인된 문제점</h4>');
      lines(it.b4).forEach(function (l) { p.push('<p>' + esc(l) + '</p>'); });
      if (evidRows(it).length) {
        p.push('<p class="caption">[표] 세부 증빙 내역</p>');
        p.push('<div class="table-scroll"><table><thead><tr><th style="width:7%">NO.</th><th style="width:14%">일자</th><th style="width:19%">증빙 항목</th><th>내용</th><th style="width:15%">금액(원)</th><th style="width:15%">비고</th></tr></thead><tbody>');
        evidRows(it).forEach(function (e, k) {
          p.push('<tr><td>' + (k + 1) + '</td><td>' + esc(e.date || '') + '</td><td class="l">' + esc(e.title || '') + '</td><td class="l">' + esc(e.body || '') + '</td><td>' + esc(e.amount || '') + '</td><td>' + esc(e.note || '') + '</td></tr>');
        });
        p.push('</tbody></table></div>');
      }
      p.push('<h4 class="sec">조치할 사항</h4>');
      lines(it.b5).forEach(function (l) { p.push('<p>' + esc(l) + '</p>'); });
      if ((it.subjects || []).length) {
        p.push('<p class="note">[관련자]</p>');
        p.push('<div class="table-scroll"><table><thead><tr><th>소속</th><th>직급</th><th>성명</th><th>직무</th><th>담당기간</th><th>처분요구</th></tr></thead><tbody>');
        it.subjects.forEach(function (s) {
          p.push('<tr><td>' + esc(s.org || '') + '</td><td>' + esc(s.rank || '') + '</td><td>' + esc(s.name || '') + '</td><td>' + esc(s.duty || '') + '</td><td>' + esc(s.period || '') + '</td><td>' + esc(s.req || '') + '</td></tr>');
        });
        p.push('</tbody></table></div>');
      }
      p.push('</div>');
    });

    /* 붙임2 */
    var allCites = [];
    state.items.forEach(function (it) { allCites = allCites.concat(citeAnnex(it)); });
    p.push('<div class="doc-page">');
    p.push('<div class="annex-head"><div class="annex-label">붙임<br>2</div><div class="annex-title">관련근거 등 참고자료</div></div>');
    if (allCites.length) {
      allCites.forEach(function (c, i) { p.push('<p>' + (i + 1) + '. ' + esc(c) + '</p>'); });
    } else {
      p.push('<p class="note">담은 근거가 없어 참고자료 목록이 비어 있습니다.</p>');
    }
    p.push('</div>');

    $('previewRoot').innerHTML = p.join('');
  }

  function docHeading() {
    var r = (state.meta.round || '').trim();
    if (!r) return '감사처분심의위원회 결과보고';
    if (!/^제/.test(r)) r = '제' + r;
    if (!/회$/.test(r)) r += '회';
    return r + ' 감사처분심의위원회 결과보고';
  }

  function fillFileName() {
    var t = (state.meta.docTitle || state.items[0].title || '감사처분심의위원회_결과보고서')
      .replace(/[\\/:*?"<>|]/g, ' ').trim();
    var d = state.meta.reportDate ? state.meta.reportDate.replace(/-/g, '') : '';
    $('dlName').value = '감사처분심의위원회_결과보고서_' + t + (d ? '_' + d : '') + '.hwpx';
  }

  /* ---------------- 샘플 ---------------- */
  function loadSample() {
    state = blankState();
    state.meta = {
      round: '제12회', reportDate: '2026-11-27', docTitle: '테스트 출장비 정산 부적정 건',
      orgName: '한국생산기술연구원', auditName: '2026년 정기 종합감사', dept: '경영지원본부',
      occurredAt: '2023-12-15', awareAt: '2026-10-06', fiveYear: false,
      resType: '원안 의결', resText: '상정된 안건을 원안대로 의결함'
    };
    var it = newItem('테스트 출장비 정산 부적정 건');
    it.dept = '경영지원본부\n기업협력본부';
    it.kinds = [
      { key: '징계', n: 1, people: 1, amount: 0, note: '' },
      { key: '경고', n: 2, people: 2, amount: 0, note: '' },
      { key: '환수', n: 1, people: 0, amount: 3150000, note: '' },
      { key: '통보', n: 1, people: 0, amount: 0, note: '시정완료' }
    ];
    it.b1 = '테스트 출장비 정산 부적정 건';
    it.b2 = '한국생산기술연구원(이하 “연구원”이라 한다)은 출장자가 귀임하면 복명서를 제출받아 여비를 정산하고 있다.\n' +
      '이번 감사는 2026년 정기 종합감사로, 2026. 9. 1.부터 2026. 10. 20.까지 실시한 종합감사 결과 확인된 사항에 대한 것이다.';
    it.b3 = '「취업규칙」 제41조제4항에 따라 출장자가 귀임하였을 때에는 5일 이내에 복명서를 제출하여야 한다.\n' +
      '「임직원 행동강령」 제14조는 임직원이 출장비 등 업무수행을 위한 예산을 목적 외의 용도로 사용하여 연구원에 재산상 손해를 입혀서는 아니 된다고 정하고 있다.\n' +
      '위 행위는 출장 사실과 다른 증빙으로 여비를 정산한 것으로 위 규정에 위배된다고 판단된다.';
    it.b4 = '해당 직원은 출장지를 방문하지 않고 자택 인근에서 사용한 영수증을 출장증빙으로 제출하는 방법으로 여비를 정산하였다.\n' +
      '그 결과 2026. 3. 4.부터 2026. 8. 21.까지 6회에 걸쳐 합계 3,150,000원을 부당하게 수령한 사실이 확인되었다.';
    it.b5 = '① 부당 수령한 출장여비 3,150,000원을 환수하시기 바랍니다(환수).\n' +
      '② 관련 직원에 대하여 「징계규정」에 따른 징계절차를 진행하시기 바랍니다(징계).\n' +
      '③ 출장증빙 확인 절차를 보완하여 유사사례가 재발하지 않도록 관리하시기 바랍니다(통보).';
    it.subjects = [
      { org: '경영지원본부 총무팀', rank: '과장', name: '홍길동', duty: '총무', period: '2015.3.1. ~ 현재', req: '징계', points: '자택 인근 영수증으로 출장증빙을 대체하여 여비 2,420,000원 부당 수령' },
      { org: '기업협력본부 지원팀', rank: '대리', name: '성춘향', duty: '지원', period: '2019.7.1. ~ 현재', req: '경고', points: '출장지를 방문하지 않고 2회에 걸쳐 730,000원 부당 수령' }
    ];
    it.evidences = [
      { date: '2026-03-04', title: '출장신청서', body: '대전 → 부산 1박 2일', amount: '320,000', note: '승인번호 A-1102' },
      { date: '2026-05-12', title: '영수증', body: '자택 인근 식당 카드영수증', amount: '210,000', note: '위치 불일치' },
      { date: '2026-08-21', title: '출장복명서', body: '부산 → 대전 복귀', amount: '450,000', note: '출입기록 없음' }
    ];
    var reg1 = (window.AUDIT_REGS || []).filter(function (r) { return r.reg === '임직원 행동강령' && r.article === '제14조'; })[0];
    if (reg1) {
      it.picks.push({ type: 'reg', reg: reg1.reg, article: reg1.article, summary: reg1.summary });
    }
    var reg2 = (window.AUDIT_REGS || []).filter(function (r) { return r.reg === '취업규칙' && r.article === '제41조제4항'; })[0];
    if (reg2) {
      it.picks.push({ type: 'reg', reg: reg2.reg, article: reg2.article, summary: reg2.summary });
    }
    var c1 = (window.AUDIT_CASES || []).filter(function (c) { return c.id === 'RND-22'; })[0];
    if (c1) {
      it.picks.push({ type: 'case', id: c1.id, title: c1.title, statute: c1.statute, authority: c1.authority });
    }
    state.items = [it];
    state.active = 0;
    state.evidIdx = 0;
    state._hydrated = null;
    hydrateMeta();
    hydrateItem();
    renderItemLists();
    renderSidebar();
    toast('가상 테스트 데이터를 채웠습니다(가상 인물·가상 금액).');
  }

  /* ---------------- HWPX 생성 ---------------- */
  function buildModel() {
    var m = state.meta;
    var a = aggregate();
    var values = {
      DOC_HEADING: docHeading(),
      DOC_SUBTITLE: m.docTitle || '제목 미입력',
      REPORT_DATE: fmtDate(m.reportDate),
      ORG_NAME: m.orgName || '',
      RES_TYPE: m.resType || '',
      RES_TEXT: m.resText || '',
      'SUM.COUNT': String(a.count),
      'SUM.PEOPLE': String(a.people),
      'SUM.MONEY': fmt(a.money),
      'SUM.BYEONSANG': cellVal(a.cols['변상']),
      'SUM.JINGYE': cellVal(a.cols['징계']),
      'SUM.HWANSU': cellVal(a.cols['환수']),
      'SUM.JUUI': cellVal(a.cols['주의·경고']),
      'SUM.GAESEON': cellVal(a.cols['개선']),
      'SUM.GWONGO': cellVal(a.cols['권고']),
      'SUM.TONGBO': cellVal(a.cols['통보']),
      'SUM.GOBAL': cellVal(a.cols['고발']),
      'SUM.MOBEOM': cellVal(a.cols['모범사례'])
    };
    var rows = {
      ITEM: state.items.map(function (it, i) {
        return {
          NO: String(i + 1),
          DEPT: it.dept || m.dept || '',
          KINDS: kindNames(it) || '-',
          TITLE: it.title || m.docTitle || '',
          AMOUNT: kindAmountText(it)
        };
      }),
      SUBJ: subjectRows()
    };
    var allCite = [];
    state.items.forEach(function (it) { allCite = allCite.concat(citeAnnex(it)); });
    rows.CITE = allCite.map(function (c, k) { return { LINE: (k + 1) + '. ' + c }; });
    var docs = state.items.map(function (it, i) {
      var cites = citeAnnex(it);
      var e = evidRows(it);
      return {
        values: {
          'D.LABEL': state.items.length > 1 ? ('1-' + (i + 1)) : '1',
          'D.TITLE': it.title || m.docTitle || '',
          'D.REQ_HEADING': reqHeading(it),
          'D.B1_TITLE': it.b1 || it.title || '',
          'D.ORG': m.orgName || ''
        },
        rows: {
          B2: lines(it.b2).map(function (l) { return { LINE: l }; }),
          B3: lines(it.b3).concat(citeLines(it)).map(function (l) { return { LINE: l }; }),
          B4: lines(it.b4).map(function (l) { return { LINE: l }; }),
          B5: lines(it.b5).map(function (l) { return { LINE: l }; }),
          EVIDCAP: e.length ? [{ LINE: '세부 증빙 내역' }] : [],
          EVID: e.map(function (x, k) {
            return {
              NO: String(k + 1), DATE: x.date || '', TITLE: x.title || '',
              BODY: x.body || '', AMOUNT: x.amount || '', NOTE: x.note || ''
            };
          }),
          REL: (it.subjects || []).map(function (s) {
            return {
              ORG: s.org || '', RANK: s.rank || '', NAME: s.name || '',
              DUTY: s.duty || '', PERIOD: s.period || '', REQ: s.req || ''
            };
          }),
          CITE: cites.map(function (c, k) { return { LINE: (k + 1) + '. ' + c }; })
        }
      };
    });
    return { values: values, rows: rows, docs: docs };
  }

  var lastBuild = null;

  async function generate() {
    readForms();
    var btn = $('genBtn');
    btn.disabled = true;
    btn.textContent = '만드는 중…';
    var rp = $('resultPanel');
    rp.hidden = true;
    rp.innerHTML = '';
    try {
      var res = await window.HwpxBuilder.build(buildModel());
      var chk = await window.HwpxBuilder.selfCheck(res.blob);
      var name = ($('dlName').value || '감사처분심의위원회_결과보고서.hwpx').replace(/\.hwpx$/i, '') + '.hwpx';
      var url = URL.createObjectURL(res.blob);
      var box = $('resultPanel');
      box.hidden = false;
      var ok = chk.mimetype && chk.xmlParsed && chk.leftoverTokens === 0;
      box.innerHTML = '<p class="' + (ok ? 'ok' : 'bad') + '">' + (ok ? '✓ 생성 완료 — 자기 점검 통과' : '⚠ 생성은 됐지만 점검 항목을 확인하세요') + '</p>' +
        '<ul>' +
        '<li>파일: ' + esc(name) + ' · ' + fmt(res.stats.bytes) + ' bytes</li>' +
        '<li>구조: 문단 ' + res.stats.paragraphs + ' · 표 ' + res.stats.tables + ' · 행 ' + res.stats.rows + '</li>' +
        '<li>mimetype 첫 엔트리·무압축: ' + (chk.mimetype ? '통과' : '실패') + ' (첫 엔트리 ' + esc(chk.firstEntry) + ')</li>' +
        '<li>section0.xml 파싱: ' + (chk.xmlParsed ? '통과' : '실패') + ' · 남은 토큰 ' + chk.leftoverTokens + '개</li>' +
        '</ul>' +
        '<a class="dl-link" href="' + url + '" download="' + esc(name) + '">↓ ' + esc(name) + ' 내려받기</a>';
      lastBuild = { res: res, chk: chk, name: name };
      window.__lastBuild = lastBuild;
      toast('HWPX를 만들었습니다. 아래 링크로 내려받으세요.');
    } catch (e) {
      console.error(e);
      $('resultPanel').hidden = false;
      $('resultPanel').innerHTML = '<p class="bad">생성 실패: ' + esc(e.message || e) + '</p>';
    } finally {
      btn.disabled = false;
      btn.textContent = '.hwpx 파일 만들기';
    }
  }

  function aiText() {
    readForms();
    var m = state.meta, a = aggregate(), st = statute();
    var out = [];
    out.push('# 감사처분심의위원회 결과보고서 — AI 입력용 구조');
    out.push('');
    out.push('## 1. 문서·감사 기본정보');
    out.push('- 심의위원회: ' + (state.meta.round || '-'));
    out.push('- 보고일: ' + (fmtDate(m.reportDate) || '-'));
    out.push('- 제목: ' + (m.docTitle || '-'));
    out.push('- 기관: ' + (m.orgName || '-'));
    out.push('- 감사명: ' + (m.auditName || '-'));
    out.push('- 관계부서: ' + (m.dept || '-'));
    out.push('- 행위 발생일: ' + (fmtDate(m.occurredAt) || '-') + ' / 인지일: ' + (fmtDate(m.awareAt) || '-'));
    out.push('- 시효: ' + (st ? st.label + ' (만료 ' + fmtDate(localDate(st.expiry)) + ', ' + st.years + '년 기준)' : '미계산'));
    out.push('- 의결: ' + (m.resType || '-') + ' / ' + (m.resText || '-'));
    out.push('');
    out.push('## 2. 총괄');
    out.push('- 처분요구건수 ' + a.count + ' · 신분상조치인원 ' + a.people + ' · 재정상조치금액 ' + fmt(a.money) + '원');
    COL_ORDER.forEach(function (c) { out.push('- ' + c + ': ' + cellVal(a.cols[c])); });
    out.push('');
    state.items.forEach(function (it, i) {
      out.push('## 3-' + (i + 1) + '. ' + (it.title || '제목 미입력'));
      out.push('- 관계부서: ' + (it.dept || m.dept || '-'));
      out.push('- 처분요구: ' + (kindNames(it) || '-').replace(/\n/g, ', ') + ' / ' + kindAmountText(it).replace(/\n/g, ', '));
      out.push('### ① 제목'); out.push(it.b1 || it.title || '-');
      out.push('### ② 경위'); lines(it.b2).forEach(function (l) { out.push('- ' + l); });
      out.push('### ③ 사실관계'); lines(it.b4).forEach(function (l) { out.push('- ' + l); });
      out.push('### ④ 판단·법령');
      lines(it.b3).forEach(function (l) { out.push('- ' + l); });
      citeLines(it).forEach(function (l) { out.push('- ' + l); });
      out.push('### ⑤ 처분요구'); lines(it.b5).forEach(function (l) { out.push('- ' + l); });
      out.push('### 대상자');
      (it.subjects || []).forEach(function (s) {
        out.push('- ' + [s.org, s.rank, s.name, s.duty, s.period, s.req].filter(Boolean).join(' / ') + ' :: ' + (s.points || '').replace(/\n/g, ' '));
      });
      out.push('### 세부 증빙');
      (it.evidences || []).forEach(function (e, k) {
        out.push('- ' + (k + 1) + '. ' + [e.date, e.title, e.body, e.amount, e.note].filter(Boolean).join(' | '));
      });
      out.push('');
    });
    out.push('## 4. 담은 근거(원문 인용)');
    state.items.forEach(function (it, i) {
      (it.picks || []).forEach(function (p) {
        out.push('- [' + (i + 1) + '] ' + (p.type === 'case'
          ? '사례 ' + p.id + ' — ' + p.title + ' / ' + (p.statute || '') + ' / ' + (p.authority || '')
          : p.reg + ' ' + p.article + ' — ' + p.summary));
      });
    });
    out.push('');
    out.push('> 주의: 인용은 위에 담긴 원문만 사용하고, 양정(징계 종류·정도)은 감사인이 결정합니다.');
    return out.join('\n');
  }

  function copyText(text) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) { /* noop */ }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(fallback);
    } else fallback();
  }

  /* ---------------- 이벤트 ---------------- */
  function bind() {
    $('helpBtn').addEventListener('click', function () { $('helpModal').hidden = false; });
    $('helpClose').addEventListener('click', function () { $('helpModal').hidden = true; });
    $('helpModal').addEventListener('click', function (e) {
      if (e.target === $('helpModal')) $('helpModal').hidden = true;
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('helpModal').hidden) $('helpModal').hidden = true;
    });

    $('resetBtn').addEventListener('click', function () {
      if (!confirm('입력한 내용을 모두 지우고 처음부터 시작할까요? (이 브라우저에만 저장된 값입니다)')) return;
      localStorage.removeItem(STORAGE_KEY);
      state = blankState();
      state._hydrated = null;
      hydrateMeta();
      hydrateItem();
      renderItemLists();
      renderSidebar();
      goStep(1, true);
      toast('초기화했습니다.');
    });

    $('loadSample').addEventListener('click', loadSample);

    document.querySelectorAll('[data-goto]').forEach(function (b) {
      b.addEventListener('click', function () { goStep(Number(b.dataset.goto)); });
    });
    document.querySelectorAll('.step').forEach(function (b) {
      b.addEventListener('click', function () { goStep(Number(b.dataset.step)); });
    });

    ['f-round', 'f-reportDate', 'f-docTitle', 'f-orgName', 'f-dept', 'f-auditName',
      'f-occurredAt', 'f-awareAt', 'f-resType', 'f-resText'].forEach(function (id) {
      $(id).addEventListener('input', function () { readForms(); renderSidebar(); save(); });
    });
    $('f-fiveYear').addEventListener('change', function () { readForms(); renderSidebar(); save(); });

    ['i-title', 'i-dept', 'i-b1', 'i-b2', 'i-b3', 'i-b4', 'i-b5'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        readForms();
        renderSidebar();
        if (id === 'i-title') renderItemLists();
        save();
      });
    });

    $('addItem').addEventListener('click', function () {
      readForms();
      state.items.push(newItem(''));
      state.active = state.items.length - 1;
      state._hydrated = null;
      hydrateItem(); renderItemLists(); renderSidebar(); save();
      $('i-title').focus();
    });

    $('itemTabs').addEventListener('click', function (e) {
      var del = e.target.closest('[data-del]');
      if (del) {
        e.stopPropagation();
        readForms();
        var idx = Number(del.dataset.del);
        if (state.items.length === 1) { toast('건은 최소 1개가 필요합니다.'); return; }
        if (!confirm('이 건을 삭제할까요?')) return;
        state.items.splice(idx, 1);
        state.active = Math.max(0, Math.min(state.active, state.items.length - 1));
        state.evidIdx = Math.min(state.evidIdx, state.items.length - 1);
        state._hydrated = null;
        hydrateItem(); renderItemLists(); renderSidebar(); save();
        return;
      }
      var tab = e.target.closest('[data-idx]');
      if (!tab) return;
      readForms();
      state.active = Number(tab.dataset.idx);
      state._hydrated = null;
      hydrateItem(); renderItemLists(); renderSidebar(); save();
    });

    $('addKind').addEventListener('click', function () {
      readForms();
      var it = state.items[state.active];
      it.kinds.push(newKind());
      renderKinds(); renderSidebar(); save();
    });

    $('kindBody').addEventListener('input', function (e) {
      var t = e.target;
      var i = Number(t.dataset.i);
      var k = t.dataset.k;
      if (!k || isNaN(i)) return;
      var it = state.items[state.active];
      if (!it || !it.kinds[i]) return;
      if (k === 'key') { it.kinds[i].key = t.value; renderKinds(); }
      else if (k === 'note') it.kinds[i].note = t.value;
      else it.kinds[i][k] = Number(t.value) || 0;
      renderSidebar(); save();
    });
    $('kindBody').addEventListener('change', function (e) {
      if (e.target.dataset.k === 'key') {
        var i = Number(e.target.dataset.i);
        var it = state.items[state.active];
        it.kinds[i].key = e.target.value;
        renderKinds(); renderSidebar(); save();
      }
    });
    $('kindBody').addEventListener('click', function (e) {
      var b = e.target.closest('[data-delkind]');
      if (!b) return;
      readForms();
      var i = Number(b.dataset.delkind);
      var it = state.items[state.active];
      if (it.kinds.length <= 1) { toast('종류는 최소 1개가 필요합니다.'); return; }
      it.kinds.splice(i, 1);
      renderKinds(); renderSidebar(); save();
    });

    $('addSubject').addEventListener('click', function () {
      readForms();
      state.items[state.active].subjects.push(newSubject());
      renderSubjects(); renderSidebar(); save();
    });
    $('subjectList').addEventListener('input', function (e) {
      var t = e.target;
      var i = Number(t.dataset.i);
      var k = t.dataset.sk;
      if (!k || isNaN(i)) return;
      var it = state.items[state.active];
      if (it.subjects[i]) it.subjects[i][k] = t.value;
      save();
    });
    $('subjectList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-delsub]');
      if (!b) return;
      readForms();
      state.items[state.active].subjects.splice(Number(b.dataset.delsub), 1);
      renderSubjects(); renderSidebar(); save();
    });

    document.querySelectorAll('.seg-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.seg-btn').forEach(function (x) { x.classList.remove('is-active'); });
        b.classList.add('is-active');
        searchState.src = b.dataset.src;
        renderSearch();
      });
    });
    $('caseChips').addEventListener('click', function (e) {
      var c = e.target.closest('[data-cat]');
      if (!c) return;
      searchState.cat = c.dataset.cat;
      renderSearch();
    });
    var deb;
    $('evSearch').addEventListener('input', function (e) {
      clearTimeout(deb);
      deb = setTimeout(function () { searchState.q = e.target.value; renderSearch(); }, 140);
    });
    $('suggestBtn').addEventListener('click', function () {
      var it = state.items[state.active];
      var src = [it.title, it.b1, it.b2, it.b4].join(' ');
      var words = src.replace(/[^\uAC00-\uD7A3A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(function (w) { return w.length >= 2; });
      var pick = words.slice(0, 1).join(' ') || '출장';
      $('evSearch').value = pick;
      searchState.q = pick;
      renderSearch();
      toast('입력에서 「' + pick + '」 로 검색했습니다.');
    });

    $('evResults').addEventListener('click', function (e) {
      var pickBtn = e.target.closest('[data-pick]');
      var detailBtn = e.target.closest('[data-detail]');
      var it = state.items[state.active];
      if (pickBtn) {
        readForms();
        if (pickBtn.dataset.pick === 'case') {
          var c = (window.AUDIT_CASES || []).filter(function (x) { return x.id === pickBtn.dataset.id; })[0];
          if (c && !it.picks.some(function (p) { return p.type === 'case' && p.id === c.id; })) {
            it.picks.push({ type: 'case', id: c.id, title: c.title, statute: c.statute, authority: c.authority, rationale: c.rationale });
          }
        } else {
          var r = (window.__regShown || [])[Number(pickBtn.dataset.ri)];
          if (r && !it.picks.some(function (p) { return p.type === 'reg' && p.reg === r.reg && p.article === r.article; })) {
            it.picks.push({ type: 'reg', reg: r.reg, article: r.article, summary: r.summary });
          }
        }
        renderSearch(); renderPicked(); renderSidebar(); save();
        return;
      }
      if (detailBtn) {
        var id = detailBtn.dataset.detail;
        var box = document.querySelector('[data-detailbox="' + id + '"]');
        var c2 = (window.AUDIT_CASES || []).filter(function (x) { return x.id === id; })[0];
        if (!box || !c2) return;
        if (!box.hidden) { box.hidden = true; return; }
        box.hidden = false;
        box.innerHTML = '<div class="res-meta" style="margin-top:8px"><strong>쟁점</strong> ' + esc(c2.dilemma || '-') + '</div>' +
          '<div class="res-meta"><strong>조문</strong> ' + esc(c2.statute || '-') + '</div>' +
          '<div class="res-meta"><strong>근거</strong> ' + esc(c2.authority || '-') + '</div>' +
          '<div class="res-meta"><strong>판단 요지</strong> ' + esc(c2.rationale || '-') + '</div>' +
          '<div class="res-meta"><strong>사실관계</strong> ' + esc(c2.facts || '-') + '</div>';
      }
    });

    $('clearPicked').addEventListener('click', function () {
      readForms();
      state.items[state.active].picks = [];
      renderPicked(); renderSearch(); renderSidebar(); save();
    });
    $('pickedList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-unpick]');
      if (!b) return;
      readForms();
      state.items[state.active].picks.splice(Number(b.dataset.unpick), 1);
      renderPicked(); renderSearch(); renderSidebar(); save();
    });

    $('evidItemSelect').addEventListener('change', function (e) {
      state.evidIdx = Number(e.target.value) || 0;
      renderEvidTable(); save();
    });
    $('addEvidRow').addEventListener('click', function () {
      var it = curEvidItem();
      it.evidences.push({ date: '', title: '', body: '', amount: '', note: '' });
      renderEvidTable(); save();
    });
    $('evidBody').addEventListener('input', function (e) {
      var t = e.target;
      var i = Number(t.dataset.i);
      var k = t.dataset.ek;
      if (!k || isNaN(i)) return;
      var it = curEvidItem();
      if (it.evidences[i]) it.evidences[i][k] = t.value;
      save();
    });
    $('evidBody').addEventListener('click', function (e) {
      var b = e.target.closest('[data-delevid]');
      if (!b) return;
      var it = curEvidItem();
      it.evidences.splice(Number(b.dataset.delevid), 1);
      renderEvidTable(); save();
    });
    $('applyCsv').addEventListener('click', function () {
      var raw = $('evidCsv').value.trim();
      if (!raw) { toast('붙여넣은 내용이 없습니다.'); return; }
      var rows = raw.split(/\r?\n/).map(function (l) { return l.split(/,|\t/).map(function (x) { return x.trim(); }); })
        .filter(function (r) { return r.some(function (x) { return x; }); });
      if (rows.length && /일자|날짜|증빙|내용/.test(rows[0][0] + (rows[0][1] || ''))) rows.shift();
      var it = curEvidItem();
      rows.forEach(function (r) {
        it.evidences.push({ date: r[0] || '', title: r[1] || '', body: r[2] || '', amount: r[3] || '', note: r[4] || '' });
      });
      $('evidCsv').value = '';
      renderEvidTable(); save();
      toast(rows.length + '행을 넣었습니다.');
    });

    $('refreshPreview').addEventListener('click', function () { renderPreview(); renderSum(); toast('미리보기를 새로 고쳤습니다.'); });
    $('genBtn').addEventListener('click', generate);
    $('copyAi').addEventListener('click', function () { copyText(aiText()); toast('AI 입력용 텍스트를 복사했습니다.'); });

    window.addEventListener('beforeunload', function () { readForms(); save(); });
  }

  /* ---------------- init ---------------- */
  function init() {
    var restored = load();
    bind();
    hydrateMeta();
    hydrateItem();
    renderItemLists();
    renderSidebar();
    $('step1').hidden = state.step !== 1;
    $('step2').hidden = state.step !== 2;
    $('step3').hidden = state.step !== 3;
    $('step4').hidden = state.step !== 4;
    Array.prototype.forEach.call(document.querySelectorAll('.step'), function (b) {
      b.classList.toggle('is-active', Number(b.dataset.step) === state.step);
    });
    if (restored) toast('이 브라우저에 저장된 작성 내용을 불러왔습니다.');
  }

  window.__app = {
    get state() { return state; },
    goStep: goStep,
    loadSample: loadSample,
    buildModel: buildModel,
    aiText: aiText,
    renderPreview: renderPreview,
    aggregate: aggregate,
    hydrateMeta: hydrateMeta,
    hydrateItem: hydrateItem
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
