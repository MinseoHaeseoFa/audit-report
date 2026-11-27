/* =====================================================================
 * hwpx-writer.js — 클린 마스터 템플릿(.hwpx)에 입력값을 바인딩해 새 .hwpx 를 만든다.
 *
 * 원칙
 *  - 서식은 마스터 템플릿의 개체(hp:p / hp:run / charPrIDRef / paraPrIDRef /
 *    hp:tbl / hp:tc / cellSpan)를 그대로 쓴다. 새로 만들지 않는다.
 *  - 텍스트만 hp:t 노드에서 치환하고, 반복 행(hp:tr)·반복 문단은 복제한다.
 *  - 서버·외부 요청 없음. 브라우저 안에서만 처리한다.
 * ===================================================================== */
(function (global) {
  'use strict';

  var HPN = 'http://www.hancom.co.kr/hwpml/2011/paragraph';
  var MIME = 'application/hwp+zip';

  function el(doc, name) {
    return doc.createElementNS(HPN, 'hp:' + name);
  }

  function all(root, name) {
    return Array.prototype.slice.call(root.getElementsByTagNameNS(HPN, name));
  }

  /* 문단 자신의 텍스트(표·셀 안쪽 제외) */
  function ownTexts(p) {
    var out = [];
    (function walk(node) {
      for (var c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        if (c.localName === 'tbl') continue;
        if (c.localName === 't') out.push(c);
        else walk(c);
      }
    })(p);
    return out;
  }

  function tokenNames(text) {
    var out = [], m, re = /\{\{([^{}]+)\}\}/g;
    while ((m = re.exec(text))) out.push(m[1]);
    return out;
  }

  function repeatGroups(root) {
    var g = [];
    root.forEach(function (t) {
      tokenNames(t.textContent).forEach(function (n) {
        if (n.indexOf('R:') === 0) {
          var name = n.slice(2).split('.')[0];
          if (g.indexOf(name) < 0) g.push(name);
        }
      });
    });
    return g;
  }

  /* 값의 \n 을 hp:lineBreak 로 바꿔 한 셀 안 여러 줄을 만든다 */
  function setText(t, value) {
    var s = value == null ? '' : String(value);
    var doc = t.ownerDocument;
    if (s.indexOf('\n') < 0) { t.textContent = s; return; }
    var parts = s.split('\n');
    var run = t.parentNode;
    parts.forEach(function (part, i) {
      if (i > 0) run.insertBefore(el(doc, 'lineBreak'), t);
      if (part !== '') {
        var nt = el(doc, 't');
        nt.textContent = part;
        run.insertBefore(nt, t);
      }
    });
    run.removeChild(t);
  }

  function has(map, key) {
    return map && Object.prototype.hasOwnProperty.call(map, key);
  }

  /* 한 개체(문단/행/표) 안의 모든 토큰을 값으로 치환 */
  function fill(root, map) {
    all(root, 't').forEach(function (t) {
      var s = t.textContent;
      if (s.indexOf('{{') < 0) return;
      s = s.replace(/\{\{R:([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\}\}/g, function (m, g, f) {
        return has(map, f) ? String(map[f]) : '';
      });
      s = s.replace(/\{\{([A-Za-z0-9_.]+)\}\}/g, function (m, name) {
        return has(map, name) ? String(map[name]) : '';
      });
      setText(t, s);
    });
  }

  function rowsOf(ctx, group) {
    var r = ctx && ctx.rows;
    if (!r || !Object.prototype.hasOwnProperty.call(r, group)) return [];
    return r[group] || [];
  }

  function renumber(tbl) {
    var doc = tbl.ownerDocument;
    var trs = Array.prototype.filter.call(tbl.children, function (c) { return c.localName === 'tr'; });
    var total = 0;
    trs.forEach(function (tr, i) {
      var rowH = 0;
      Array.prototype.forEach.call(tr.children, function (tc) {
        if (tc.localName !== 'tc') return;
        var addr = tc.getElementsByTagNameNS(HPN, 'cellAddr')[0];
        if (addr) addr.setAttribute('rowAddr', String(i));
        var sz = tc.getElementsByTagNameNS(HPN, 'cellSz')[0];
        if (sz) rowH = Math.max(rowH, parseInt(sz.getAttribute('height') || '0', 10) || 0);
      });
      total += rowH;
    });
    tbl.setAttribute('rowCnt', String(trs.length));
    var sz = tbl.getElementsByTagNameNS(HPN, 'sz')[0];
    if (sz && total) sz.setAttribute('height', String(total));
    return trs.length;
  }

  function removeParagraphIfEmpty(p) {
    if (p.localName !== 'p') return;
    var txt = ownTexts(p).map(function (t) { return t.textContent; }).join('').trim();
    if (txt) return;
    var objs = all(p, 'tbl').length + all(p, 'pic').length + all(p, 'equation').length;
    if (objs === 0 && p.parentNode) p.parentNode.removeChild(p);
  }

  /* 표의 반복 행 처리 */
  function processTable(tbl, ctx) {
    if (!tbl.parentNode) return;
    var trs = Array.prototype.filter.call(tbl.children, function (c) { return c.localName === 'tr'; });
    var emptied = false;
    trs.forEach(function (tr) {
      var groups = repeatGroups(all(tr, 't'));
      if (!groups.length) return;
      var g = groups[0];
      var rows = rowsOf(ctx, g);
      if (!rows.length) { emptied = true; tbl.removeChild(tr); return; }
      rows.forEach(function (row) {
        var clone = tr.cloneNode(true);
        fill(clone, row);
        tbl.insertBefore(clone, tr);
      });
      tbl.removeChild(tr);
    });
    if (emptied) {
      var parent = tbl.parentNode;
      if (parent) {
        parent.removeChild(tbl);
        var run = parent;
        var host = run;
        while (host && host.localName !== 'p') host = host.parentNode;
        if (host) {
          var txt = ownTexts(host).map(function (t) { return t.textContent; }).join('').trim();
          var objs = all(host, 'tbl').length + all(host, 'pic').length;
          if (!txt && objs === 0 && host.parentNode) host.parentNode.removeChild(host);
        }
      }
      return;
    }
    renumber(tbl);
  }

  /* 문단 반복(본문 블록 줄, 표 캡션 등) */
  function processParagraph(p, ctx) {
    if (!p.parentNode) return;
    var groups = repeatGroups(ownTexts(p));
    if (!groups.length) return;
    var rows = rowsOf(ctx, groups[0]);
    var parent = p.parentNode;
    if (!rows.length) { parent.removeChild(p); return; }
    rows.forEach(function (row) {
      var clone = p.cloneNode(true);
      fill(clone, row);
      parent.insertBefore(clone, p);
    });
    parent.removeChild(p);
  }

  function processElements(elements, ctx) {
    elements.forEach(function (elm) {
      var tbls = elm.localName === 'tbl' ? [elm] : all(elm, 'tbl');
      tbls.forEach(function (tb) { processTable(tb, ctx); });
    });
    elements.forEach(function (elm) {
      var ps = elm.localName === 'p' ? [elm].concat(all(elm, 'p')) : all(elm, 'p');
      ps.forEach(function (p) { processParagraph(p, ctx); });
    });
    elements.forEach(function (elm) { fill(elm, ctx.values); });
  }

  function b64ToBytes(b64) {
    var bin = global.atob(b64);
    var len = bin.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function plainText(root) {
    return all(root, 'p').map(function (p) {
      return all(p, 't').map(function (t) { return t.textContent; }).join('');
    }).filter(function (s) { return s.trim(); }).join('\n');
  }

  /**
   * model = {
   *   values: {DOC_HEADING, DOC_SUBTITLE, REPORT_DATE, ORG_NAME, RES_TYPE, RES_TEXT, "SUM.COUNT": ...},
   *   rows:   {ITEM:[...], SUBJ:[...]},        // 문서 전체 반복
   *   docs:   [{ values:{...}, rows:{B2:[{LINE}], EVID:[...], ...} }]
   * }
   */
  async function build(model) {
    if (!global.JSZip) throw new Error('JSZip 이 없습니다.');
    var src = await global.JSZip.loadAsync(b64ToBytes(global.MASTER_HWPX_B64));
    var xml = await src.file('Contents/section0.xml').async('string');
    var dom = new DOMParser().parseFromString(xml, 'application/xml');
    if (dom.getElementsByTagName('parsererror').length) throw new Error('템플릿 XML 파싱 실패');
    var root = dom.documentElement;

    /* 1) 건별 블록(SEC:DOC ~ SEC:END) 분리 */
    var kids = Array.prototype.slice.call(root.children);
    var startIdx = -1, endIdx = -1;
    kids.forEach(function (k, i) {
      if (k.localName !== 'p') return;
      var s = ownTexts(k).map(function (t) { return t.textContent; }).join('').trim();
      if (s === '{{SEC:DOC}}') startIdx = i;
      if (s === '{{SEC:END}}') endIdx = i;
    });
    var block = [];
    var blockXML = [];
    var anchor = null;
    if (startIdx >= 0 && endIdx > startIdx) {
      block = kids.slice(startIdx + 1, endIdx);
      blockXML = block.map(function (b) { return new XMLSerializer().serializeToString(b); });
      /* 시작 표지는 빈 문단으로 남긴다 — 이 문단이 있어야 붙임1 표가 쪽 넘김 없이 이어진다 */
      ownTexts(kids[startIdx]).forEach(function (t) { t.textContent = ''; });
      anchor = dom.createComment('docs');
      root.insertBefore(anchor, kids[endIdx]);
      block.forEach(function (b) { root.removeChild(b); });
      root.removeChild(kids[endIdx]);
    }

    /* 2) 문서 전체부 처리 */
    var globals = Array.prototype.slice.call(root.children);
    processElements(globals, { values: model.values || {}, rows: model.rows || {} });

    /* 3) 건별 블록 복제 */
    if (block.length && anchor) {
      (model.docs || []).forEach(function (doc, i) {
        var frag = blockXML.map(function (x) {
          var d2 = new DOMParser().parseFromString(x, 'application/xml');
          return dom.importNode(d2.documentElement, true);
        });
        if (i > 0 && frag[0].localName === 'p') frag[0].setAttribute('pageBreak', '1');
        frag.forEach(function (f) { root.insertBefore(f, anchor); });
        processElements(frag, { values: doc.values || {}, rows: doc.rows || {} });
      });
      root.removeChild(anchor);
    }

    var out = new XMLSerializer().serializeToString(dom);
    out = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n' + out.replace(/^<\?xml[^>]*\?>\s*/, '');

    /* 4) 미리보기 텍스트도 실제 내용으로 */
    var prv = plainText(root).slice(0, 4000);

    /* 5) ZIP 재포장 — mimetype 첫 엔트리·무압축 */
    var names = Object.keys(src.files).filter(function (n) { return !src.files[n].dir; });
    var zip = new global.JSZip();
    zip.file('mimetype', MIME, { compression: 'STORE' });
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      if (n === 'mimetype') continue;
      if (n === 'Contents/section0.xml') { zip.file(n, out, { compression: 'DEFLATE' }); continue; }
      if (n === 'Preview/PrvText.txt') { zip.file(n, prv, { compression: 'DEFLATE' }); continue; }
      var data = await src.file(n).async('uint8array');
      zip.file(n, data, { compression: 'DEFLATE' });
    }
    var blob = await zip.generateAsync({ type: 'blob', mimeType: MIME, compression: 'DEFLATE' });
    return {
      blob: blob,
      xml: out,
      stats: {
        bytes: blob.size,
        paragraphs: all(root, 'p').length,
        tables: all(root, 'tbl').length,
        rows: all(root, 'tr').length
      }
    };
  }

  /* 생성 파일 자체 점검: ZIP 머리(mimetype 첫·STORE) + section0.xml 파싱 */
  async function selfCheck(blob) {
    var buf = new Uint8Array(await blob.arrayBuffer());
    var dv = new DataView(buf.buffer);
    var nameLen = dv.getUint16(26, true);
    var firstName = new TextDecoder().decode(buf.slice(30, 30 + nameLen));
    var method = dv.getUint16(8, true);
    var z = await global.JSZip.loadAsync(buf);
    var sec = z.file('Contents/section0.xml');
    var txt = sec ? await sec.async('string') : '';
    var parsed = false;
    try {
      var d = new DOMParser().parseFromString(txt, 'application/xml');
      parsed = d.getElementsByTagName('parsererror').length === 0 && !!d.documentElement;
    } catch (e) { parsed = false; }
    var leftover = (txt.match(/\{\{[^}]+\}\}/g) || []).length;
    return {
      firstEntry: firstName,
      stored: method === 0,
      mimetype: firstName === 'mimetype' && method === 0,
      xmlParsed: parsed,
      leftoverTokens: leftover,
      entries: Object.keys(z.files).filter(function (n) { return !z.files[n].dir; }).length
    };
  }

  global.HwpxBuilder = { build: build, selfCheck: selfCheck };
})(window);
