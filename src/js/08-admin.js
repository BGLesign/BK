  /* ---------- 관리자 ---------- */
  /* 관리자 페이지 없음: 관리자로 지정된 직원은 서명지 목록 화면에서 바로 관리 (카드 밀기 [정보 수정]·[내보내기], 새 서명지 열기, 배포용 아이디, 개인 코드 관리, 관리자 지정)
   * 관리자 등급은 로그인 때 받음 (staff.lv). 관리 기능도 직원 로그인 토큰을 그대로 씀 (따로 관리자 접속 없음, 서버가 요청마다 등급 확인)
   * 관리자 정보(양식 목록·서명지 현황)는 목록이 뜬 뒤 조용히 미리 받음 (admEnsure quiet) */
  var admTok = null, admData = null, admExp = {}, admOrder = {};
  var admMe = null;                      // 로그인한 관리자의 { dept, team, lv }: 새 서명지 부서명·팀 기본값
  var PDF_TPL = '__pdf__';               // 새 서명지 양식 고르는 칸의 [PDF 서명지] (누구나)
  var admWait = [], admFails = [], admMsgs = [];
  function isAdm() { return !!(staff && staff.admin && !staff.guest && staff.token); }
  /** 관리자 등급 1~3 (예전에 저장된 로그인은 선임관리자 = 3) */
  function admLv() { return !isAdm() ? 0 : Number(staff.lv) || (staff.master ? 3 : 1); }
  /** 관리자 정보가 없으면 받은 뒤 cb (여러 번 불러도 서버는 한 번). quiet: 미리 받기 (안내 글 없음) */
  function admEnsure(cb, m, onFail, quiet) {
    if (isAdm()) admTok = staff.token;
    if (admTok && admData) { cb(); return; }
    if (!isAdm()) { if (onFail) onFail(); return; }
    if (!quiet) { m = m || $('msg1'); admMsgs.push(m); msg(m, '관리자 정보 불러오는 중…', '#6b7686'); }
    admWait.push(cb); if (onFail) admFails.push(onFail);
    if (admWait.length > 1) return;
    var clear = function () { admMsgs.forEach(function (x) { msg(x, ''); }); };
    var done = function () { var w = admWait; admWait = []; admFails = []; clear(); admMsgs = []; w.forEach(function (f) { f(); }); };
    var fail = function (e) {
      var fs = admFails, ms = admMsgs; admWait = []; admFails = []; admMsgs = [];
      if (/로그인이 필요/.test(errText(e))) { logout(errText(e)); return; }
      ms.forEach(function (x) { msg(x, errText(e), '#c0392b'); }); fs.forEach(function (f) { f(e); });
    };
    BUSY_SKIP.adminRefresh = quiet ? 1 : 0;           // 미리 받기는 가운데 로딩창 없이 (목록이 뜬 뒤 도는 로딩창 없앰)
    srv().withSuccessHandler(function (d) { admMe = d.me || admMe; renderAdmin(d, true); done(); })
      .withFailureHandler(fail).adminRefresh(admTok);
  }
  function admCall(fn, args, onOk, m, onFail) {
    m = m || $('msg1');
    if (!isAdm()) { msg(m, '관리자로 지정된 직원만 할 수 있습니다.', '#c0392b'); if (onFail) onFail(); return; }
    admTok = staff.token;
    msg(m, '처리 중…', '#6b7686');
    var run = srv().withSuccessHandler(function (r) { msg(m, ''); onOk(r); })
      .withFailureHandler(function (e) {
        if (/로그인이 필요/.test(errText(e))) { logout(errText(e)); return; }
        msg(m, errText(e), '#c0392b'); if (onFail) onFail(e);
      });
    run[fn].apply(run, [admTok].concat(args));
  }
  function today() {
    var d = new Date(), w = '일월화수목금토'.charAt(d.getDay());
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return String(d.getFullYear()).slice(2) + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate()) + ' (' + w + ')';
  }

  /* ---------- 명단·임무역할 편집기 (새 서명지 열기·연 뒤 명단·임무역할 화면이 같이 씀) ----------
     역할 단추를 누른 뒤 이름을 누르면 그 역할이 붙고, 다시 누르면 빠짐 (한 사람에 여러 개). 이름 옆 ✕ = 명단에서 빼기, 아래 칸 = 이름으로 사람 추가 */
  function normO(s) { return String(s || '').replace(/[\s()（）]/g, '').toLowerCase(); }
  function rosterEd(box, onChange) {
    var ed = { dir: [], by: {}, list: [], roles: {}, names: [], sel: '', withRole: true, signed: {}, rosterNote: '' };
    box.innerHTML = '<div class="reRoleSec"><div class="reRoles"></div>' +
      '<div class="codeRow reRoleAdd"><input type="text" maxlength="40" autocomplete="off" placeholder="역할 이름 (예: 현장지휘)" enterkeyhint="done"><button type="button" class="btn gray sbtn">역할 추가</button></div>' +
      '<div class="note reRoleHint">역할 단추를 누른 뒤 아래 이름을 누르면 그 역할이 붙고, 한 번 더 누르면 빠집니다. 한 사람에 역할 여러 개를 붙일 수 있습니다.</div></div>' +
      '<div class="reHead"><b>명단</b> <span class="hint reCnt"></span></div>' +
      '<div class="slist reList"></div>' +
      '<div class="reAdd"><input type="text" autocomplete="off" placeholder="이름으로 사람 추가 (다른 팀·부서도)"><div class="reSug"></div></div>' +
      '<div class="note reMiss"></div>';
    var q = function (s) { return box.querySelector(s); };
    var changed = function () { draw(); if (onChange) onChange(); };
    function addRoleName() {
      var inp = q('.reRoleAdd input'), v = inp.value.replace(/\s+/g, ' ').trim();
      if (!v) { inp.focus(); return; }
      if (/[,，]/.test(v)) { msg(q('.reMiss'), '역할 이름에는 쉼표를 쓸 수 없습니다. 역할을 하나씩 추가하세요.', '#c0392b'); return; }
      if (/^[=+\-@]/.test(v)) { msg(q('.reMiss'), '역할 이름 맨 앞에 = + - @ 기호는 쓸 수 없습니다.', '#c0392b'); return; }
      if (ed.names.indexOf(v) < 0) ed.names.push(v);
      ed.sel = v; inp.value = ''; changed();
    }
    q('.reRoleAdd button').onclick = addRoleName;
    q('.reRoleAdd input').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); addRoleName(); } });
    var sug = q('.reSug'), sin = q('.reAdd input');
    sin.addEventListener('input', drawSug);
    function drawSug() {
      var t = normO(sin.value); sug.innerHTML = '';
      if (!t) return;
      var on = {}; ed.list.forEach(function (k) { on[k] = 1; });
      var hit = ed.dir.filter(function (p) { return !on[p.key] && normO(p.name).indexOf(t) > -1; }).slice(0, 8);
      if (!hit.length) { sug.innerHTML = '<div class="hint">찾는 직원이 없습니다 (이미 명단에 있거나 직원DB에 없음)</div>'; return; }
      hit.forEach(function (p) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'reSugItem';
        b.textContent = p.name + ' · ' + [p.disp, p.dept, p.team].filter(Boolean).join(' · ');
        b.onclick = function () { ed.list.push(p.key); if (ed.onAdd) ed.onAdd(p.key); sin.value = ''; sug.innerHTML = ''; changed(); };
        sug.appendChild(b);
      });
    }
    function draw() {
      var rs = q('.reRoles'); rs.innerHTML = '';
      ed.names.forEach(function (n) {
        var c = document.createElement('button'); c.type = 'button'; c.className = 'reRole' + (n === ed.sel ? ' on' : '');
        var cnt = ed.list.filter(function (k) { return (ed.roles[k] || []).indexOf(n) > -1; }).length;
        c.textContent = n + ' ' + cnt;
        c.onclick = function () { ed.sel = ed.sel === n ? '' : n; draw(); };
        rs.appendChild(c);
        if (n === ed.sel) {
          var x = document.createElement('button'); x.type = 'button'; x.className = 'reRoleDel'; x.textContent = '역할 지우기';
          x.onclick = function () {
            if (cnt && x.getAttribute('data-arm') !== '1') { x.setAttribute('data-arm', '1'); x.textContent = cnt + '명에게서 빠짐 · 한 번 더'; return; }
            ed.names = ed.names.filter(function (m) { return m !== n; });
            Object.keys(ed.roles).forEach(function (k) { ed.roles[k] = ed.roles[k].filter(function (m) { return m !== n; }); });
            ed.sel = ''; changed();
          };
          rs.appendChild(x);
        }
      });
      q('.reRoleSec').classList.toggle('hidden', !ed.withRole);
      var box2 = q('.reList'); box2.innerHTML = '';
      if (!ed.list.length) box2.innerHTML = '<div class="srow"><span class="hint">명단이 비어 있습니다. 부서·팀을 고르거나 아래에서 이름으로 추가하세요.</span></div>';
      ed.list.forEach(function (k) {
        var p = ed.by[k] || { name: '(직원DB에 없음)', disp: '' }, row = document.createElement('div');
        row.className = 'srow reRow' + (ed.withRole && ed.sel ? ' tap' : '');
        row.innerHTML = '<span class="nm"><small></small><span></span><span class="st"></span></span><span class="rl"></span><button type="button" class="x" title="명단에서 빼기">✕</button>';
        row.querySelector('small').textContent = p.disp || '';
        row.querySelector('.nm span').textContent = p.name;
        row.querySelector('.st').textContent = ed.signed[k] ? '서명함' : '';
        var rl = row.querySelector('.rl');
        (ed.withRole ? ed.roles[k] || [] : []).forEach(function (r) { var t = document.createElement('span'); t.className = 'reTag' + (r === ed.sel ? ' on' : ''); t.textContent = r; rl.appendChild(t); });
        row.onclick = function (ev) {
          if (ev.target.classList.contains('x')) return;
          if (!ed.withRole) return;
          if (!ed.sel) { msg(q('.reMiss'), ed.names.length ? '위에서 역할 단추를 먼저 누르세요.' : '먼저 역할 이름을 입력하고 [역할 추가]를 누르세요.', '#324eb3'); return; }
          var a = ed.roles[k] = (ed.roles[k] || []).slice(), i = a.indexOf(ed.sel);
          if (i > -1) a.splice(i, 1); else a.push(ed.sel);
          changed();
        };
        row.querySelector('.x').onclick = function () { ed.list = ed.list.filter(function (x) { return x !== k; }); if (ed.onDel) ed.onDel(k); changed(); };
        box2.appendChild(row);
      });
      var none = ed.withRole ? ed.list.filter(function (k) { return !(ed.roles[k] || []).length; }).length : 0;
      q('.reCnt').textContent = ed.list.length + '명' + (ed.withRole && ed.list.length ? ' · 역할 없음 ' + none + '명' : '');
      msg(q('.reMiss'), ed.rosterNote || '', '#6b7686');
      drawSug();
    }
    ed.setDir = function (d) { ed.dir = d || []; ed.by = {}; ed.dir.forEach(function (p) { ed.by[p.key] = p; }); draw(); };
    /** list: [{ key, role: [..] }] */
    ed.set = function (list) {
      ed.list = []; ed.roles = {}; ed.names = []; ed.sel = '';
      (list || []).forEach(function (x) { if (ed.list.indexOf(x.key) < 0) ed.list.push(x.key); ed.roles[x.key] = (x.role || []).slice();
        ed.roles[x.key].forEach(function (r) { if (ed.names.indexOf(r) < 0) ed.names.push(r); }); });
      draw();
    };
    /** 명단만 바꿈 (역할은 사번별로 남겨 둠) */
    ed.setKeys = function (keys) { ed.list = keys.slice(); draw(); };
    ed.get = function () { return ed.list.map(function (k) { return { key: k, role: ed.withRole ? (ed.roles[k] || []).slice() : [] }; }); };
    ed.role = function (on) { ed.withRole = !!on; if (!on) ed.sel = ''; draw(); };
    ed.draw = draw;
    draw();
    return ed;
  }

  /* ---------- 명단·임무역할 화면 (서명지를 연 뒤: 명단 추가·빼기, 역할 단추 → 이름 누르기) ---------- */
  var rData = null, rOrig = '', rLeave = false, rDrop = null, rEd = null;
  function rState() { return JSON.stringify(rEd.get()); }
  function rChanged() { rLeave = false; rDrop = null; $('rSave').disabled = rState() === rOrig; saveState(); }
  function openRoles(id) {
    admCall('adminRoleData', [id], function (d) { loadRoleData(d); admOverHide(true); show('sr'); }, admOverMsgEl());
  }
  function loadRoleData(d, list) {
    rData = d; rLeave = false; rDrop = null;
    if (!rEd) rEd = rosterEd($('rEd'), rChanged);
    $('rTitle').textContent = d.title;
    $('rNoCol').classList.toggle('hidden', d.hasRoleCol);
    rEd.rosterNote = d.hasRoster ? '명단에서 빼면 그 사람에게 서명지가 보이지 않습니다. 이미 서명한 사람을 빼면 저장할 때 한 번 더 확인합니다.'
      : '명단 없이 연 서명지(대상 부서 전체)입니다. 여기에 넣은 사람은 임무·역할만 정해지고, 서명지는 지금처럼 대상 부서 모두에게 보입니다.';
    rEd.signed = {}; d.signed.forEach(function (k) { rEd.signed[k] = 1; });
    rEd.withRole = d.hasRoleCol || !d.hasRoster;
    rEd.setDir(d.people); rEd.set(d.list);
    rOrig = rState();
    if (list) rEd.set(list);
    msg($('rMsg'), '');
    $('rSave').disabled = rState() === rOrig;
  }
  $('rSave').onclick = function () {
    var p = { people: rEd.get() };
    if (rDrop) p.dropSigned = rDrop;
    $('rSave').disabled = true;
    admCall('adminSetRoster', [rData.id, p], function (r) {
      if (r.confirm) {
        rDrop = r.confirm.map(function (x) { return x.key; }); $('rSave').disabled = false;
        msg($('rMsg'), '이미 서명한 사람을 명단에서 뺐습니다: ' + r.confirm.map(function (x) { return x.name; }).join(', ') + '. 한 번 더 [저장]을 누르면 그 서명은 무효가 되고 PDF에서 빠집니다.', '#c0392b');
        return;
      }
      renderAdmin(r.data); loadRoleData(r.roleData);
      msg($('rMsg'), r.data.note, '#12833b');
    }, $('rMsg'), function () { $('rSave').disabled = false; });
  };
  $('rBack').onclick = function () {
    if (rState() !== rOrig && !rLeave) {
      rLeave = true;
      msg($('rMsg'), '저장하지 않은 변경이 있습니다. 한 번 더 누르면 저장하지 않고 돌아갑니다.', '#c0392b');
      return;
    }
    rData = null; admBackToList();
  };

  /* ---------- 서명자 순서 화면 ---------- */
  var ordId = null, ord = [], ordLeave = false;
  function ordEdu() { return ordEduById(ordId); }
  function ordEduById(id) { return admData && admData.educations.filter(function (x) { return x.id === id; })[0]; }
  function openOrder(id) {
    ordId = id; ordLeave = false;
    var e = ordEdu();
    ord = (admOrder[id] || e.signers.map(function (s) { return s.key; })).slice();
    msg($('oMsg'), '');
    admOverHide(true); drawOrder(); show('so');
  }
  function ordChanged() { var e = ordEdu(); return !!e && ord.join() !== e.signers.map(function (s) { return s.key; }).join(); }
  function drawOrder() {
    var e = ordEdu();
    if (!e) { admBackToList(); return; }
    var byKey = {}; e.signers.forEach(function (s) { byKey[s.key] = s; });
    ord = ord.filter(function (k) { return byKey[k]; });
    e.signers.forEach(function (s) { if (ord.indexOf(s.key) < 0) ord.push(s.key); });
    $('oTitle').textContent = e.title;
    $('oSub').textContent = [e.dept, e.host ? '주관 ' + e.host : '', e.date].filter(Boolean).join(' · ') + ' · 서명 ' + e.signers.length + '명' + (e.pages > 1 ? ' · ' + e.pages + '페이지' : '');
    var box = $('oList'); box.innerHTML = '';
    if (!ord.length) box.innerHTML = '<div class="srow"><span class="hint">아직 서명한 사람이 없습니다.</span></div>';
    ord.forEach(function (k, i) {
      var s = byKey[k], row = document.createElement('div'); row.className = 'srow';
      row.innerHTML = '<span class="no"></span><span class="nm"><small></small><span></span></span>' +
        '<button class="mv up">↑</button><button class="mv dn">↓</button>';
      row.querySelector('.no').textContent = (i + 1) + '.';
      row.querySelector('small').textContent = s.disp || '';
      row.querySelector('.nm span').textContent = s.name + (s.role ? ' · ' + s.role : '');
      row.querySelector('.up').disabled = i === 0;
      row.querySelector('.dn').disabled = i === ord.length - 1;
      row.querySelector('.up').onclick = function () { ord.splice(i - 1, 0, ord.splice(i, 1)[0]); admOrder[ordId] = ord.slice(); ordLeave = false; drawOrder(); };
      row.querySelector('.dn').onclick = function () { ord.splice(i + 1, 0, ord.splice(i, 1)[0]); admOrder[ordId] = ord.slice(); ordLeave = false; drawOrder(); };
      box.appendChild(row);
    });
    $('oSave').disabled = !ordChanged();
    $('oDb').disabled = ord.length < 2;
    $('oDb').classList.toggle('hidden', !!e.guest);   // 본인 확인 없는 교육은 직원DB 순서 정렬 없음
    $('oHint').textContent = ordChanged() ? '바뀐 순서를 저장하세요.' : '↑ ↓로 순서를 바꾼 뒤 저장하세요.';
    saveState();
  }
  $('oSave').onclick = function () {
    $('oSave').disabled = true;
    admCall('adminReorder', [ordId, ord], function (d) {
      delete admOrder[ordId]; renderAdmin(d); ord = ordEdu().signers.map(function (s) { return s.key; }); drawOrder();
      msg($('oMsg'), '서명자 순서를 저장했습니다. PDF에 이 순서로 들어갑니다.', '#12833b');
    }, $('oMsg'));
  };
  $('oDb').onclick = function () {
    $('oDb').disabled = true;
    admCall('adminSortByDb', [ordId], function (d) {
      delete admOrder[ordId]; renderAdmin(d); ord = ordEdu().signers.map(function (s) { return s.key; }); drawOrder();
      msg($('oMsg'), '직원DB 순서로 정렬했습니다. PDF에 이 순서로 들어갑니다.', '#12833b');
    }, $('oMsg'));
  };
  $('oBack').onclick = function () {
    if (ordChanged() && !ordLeave) {   // 저장하지 않은 변경이 있으면 한 번 더 확인
      ordLeave = true;
      msg($('oMsg'), '저장하지 않은 순서가 있습니다. 한 번 더 누르면 저장하지 않고 돌아갑니다.', '#c0392b');
      return;
    }
    delete admOrder[ordId]; ordId = null;
    admBackToList();
  };

  /* 양식 미리보기: 머릿글과 줄 몇 개만 작게 그림 */
  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function tplPreview(box, name) {
    var t = admData && admData.tplPrev && admData.tplPrev[name];
    box.classList.toggle('hidden', !t);
    if (!t) { box.innerHTML = ''; return; }
    if (t.refund) {                     // 비상(환불 등록) 양식: 입력 칸 이름만 줄바꿈되는 칩으로 (칸이 많아 표로 그리면 밖으로 넘침)
      var hs = (t.blocks[0] || { heads: [] }).heads;
      box.innerHTML = '<div class="cap"><b>' + esc(name) + '</b> · 환불 등록 · 입력 칸 ' + hs.length + '개</div><div class="chips">' +
        hs.map(function (h) { return '<span>' + esc(h.t) + '</span>'; }).join('') + '</div>';
      return;
    }
    if (!t.cap) { box.innerHTML = '<div class="cap">서명 칸을 찾지 못한 양식입니다.</div>'; return; }
    var hasRole = t.blocks.some(function (b) { return b.heads.some(function (h) { return h.k === 'role'; }); });
    var rows = {}, order = [];
    t.blocks.forEach(function (b) { if (!rows[b.row]) { rows[b.row] = []; order.push(b.row); } rows[b.row].push(b); });
    var html = '<div class="cap"><b>' + esc(name) + '</b> · 한 페이지 ' + t.cap + '명' +
      (t.blocks.length > 1 ? ' · 표 ' + t.blocks.length + '개' : '') + (hasRole ? '<span class="tag">임무·역할 칸</span>' : '') + '</div>';
    var no = 0;
    order.forEach(function (r) {
      html += '<div class="wrap">';
      rows[r].forEach(function (b) {
        var cols = b.heads.length || 1;
        html += '<table><tr>' + b.heads.map(function (h) { return '<th class="k-' + (h.k || 'x') + '" title="' + esc(h.t) + '">' + esc(h.t) + '</th>'; }).join('') + '</tr>';
        var show = Math.min(2, b.n);
        for (var i = 0; i < show; i++) {
          no++;
          html += '<tr>' + b.heads.map(function (h) { return '<td>' + (h.k === 'no' ? no : '') + '</td>'; }).join('') + '</tr>';
        }
        if (b.n > show) { html += '<tr><td class="more" colspan="' + cols + '">⋮</td></tr>'; no += b.n - show; }
        html += '</table>';
      });
      html += '</div>';
    });
    box.innerHTML = html;
  }

  /** 고른 양식의 서명지에 부서 칸이 없으면(예: 양식3·4) 부서 입력칸 숨김 */
  function isRfTpl(name) { var t = admData && admData.tplPrev && admData.tplPrev[name]; return !!(t && t.refund); }
  function tplHasRole(name) { var t = admData && admData.tplPrev && admData.tplPrev[name]; return !!(t && t.blocks && t.blocks.some(function (b) { return b.heads.some(function (h) { return h.k === 'role'; }); })); }
  function tplHasDept(name) { var t = admData && admData.tplPrev && admData.tplPrev[name]; return !t || t.hasDept !== false; }
  function deptRow(row, name, guest) { row.classList.toggle('hidden', !!guest && !tplHasDept(name)); }   // 본인 확인 없는 서명지의 부서명은 양식에 적는 용도
  /** 서명지 부서명·팀 글자('A, B') → 목록 */
  function orgSplit(s) { return String(s || '').split(/\s*[,，]\s*/).filter(Boolean); }
  /** 여러 개 고르는 칸: 누르면 체크 목록이 펼쳐짐. 하나도 안 고르면 [전체]. 목록에 없는 지금 값도 남겨 둠 */
  function msel(el, list, vals, onchange) {
    vals = (vals || []).filter(Boolean);
    var all = list.concat(vals.filter(function (v) { return list.indexOf(v) < 0; }));
    el.innerHTML = '<button type="button" class="mselBtn"></button><div class="mselList hidden"></div>';
    var btn = el.firstChild, box = el.lastChild;
    el._v = vals.slice();
    var draw = function () {
      btn.textContent = el._v.length ? el._v.join(', ') : '전체';
      [].forEach.call(box.querySelectorAll('input'), function (c) { c.checked = c.value ? el._v.indexOf(c.value) > -1 : !el._v.length; });
    };
    [''].concat(all).forEach(function (v) {
      var l = document.createElement('label'), c = document.createElement('input'), sp = document.createElement('span');
      c.type = 'checkbox'; c.value = v; sp.textContent = v || '전체';
      c.onchange = function () {
        if (!v) el._v = [];
        else if (c.checked) { if (el._v.indexOf(v) < 0) el._v.push(v); el._v.sort(function (a, b) { return all.indexOf(a) - all.indexOf(b); }); }
        else el._v = el._v.filter(function (x) { return x !== v; });
        draw(); if (onchange) onchange();
      };
      l.appendChild(c); l.appendChild(sp); box.appendChild(l);
    });
    btn.disabled = !all.length;
    btn.onclick = function () { box.classList.toggle('hidden'); el.classList.toggle('open', !box.classList.contains('hidden')); };
    draw();
  }
  function mselVal(el) { return (el._v || []).slice(); }
  /** 부서명·팀 칸: 직원DB의 부서명에서 여러 개 고름. 팀은 부서를 하나만 골랐을 때 그 부서의 팀에서 (아니면 팀 칸 숨김) */
  function deptTeamSel(deptEl, teamEl, teamRow, dept, team, onchg) {
    var orgs = (admData && admData.orgs) || [];
    var teamsOf = function (d) { var o = orgs.filter(function (x) { return x.dept === d; })[0]; return o ? o.teams : []; };
    var drawTeam = function (tv) {
      var ds = mselVal(deptEl), one = ds.length === 1;
      teamRow.classList.toggle('noTeam', !one);
      msel(teamEl, one ? teamsOf(ds[0]) : [], one ? tv : [], onchg);
    };
    msel(deptEl, orgs.map(function (x) { return x.dept; }), orgSplit(dept), function () { drawTeam([]); if (onchg) onchg(); });
    drawTeam(orgSplit(team));
  }

  /** 환불 등록 고객용 QR 접수 남은 시간 표시 (서명지 목록·관리자 화면, 15초마다). 끝나도 직원 등록은 가능 */
  function tickRfLeft() { [].forEach.call(document.querySelectorAll('.rfLeft'), setRfLeft); }
  function setRfLeft(el) {
    var ms = Number(el.getAttribute('data-end')) - Date.now();
    if (ms <= 0) { el.textContent = 'QR 접수 마감 · 직원 등록 가능'; el.classList.remove('soon'); el.classList.add('over'); return; }
    var m = Math.ceil(ms / 60000), h = Math.floor(m / 60); m = m % 60;
    el.textContent = 'QR 접수 남은 시간 ' + (h ? h + '시간 ' : '') + m + '분';
    el.classList.toggle('soon', ms < 180000);               // 3분 안 남으면 빨갛게
  }
  setInterval(tickRfLeft, 15000);
  /** 새 서명지 열기: 고른 양식에 맞게 칸 보이기·숨기기 ([PDF 서명지]는 PDF 올리는 화면으로) */
  function nTplUi() {
    var sel = $('nTpl'), pdf = sel.value === PDF_TPL;
    $('nPdfNote').classList.toggle('hidden', !pdf);
    if (pdf) {
      ['nKindRow', 'nRosterBox', 'nTitleRow', 'nDeptRow', 'nTeamRow', 'nDeptNote', 'nDateRow', 'nCodeRow', 'nRfMinRow', 'nRfNote', 'nNoVerify', 'nTplPrev'].forEach(function (id) { $(id).classList.add('hidden'); });
      $('nCreate').textContent = 'PDF 서명지 만들기';
      return;
    }
    var rf = isRfTpl(sel.value);
    var gNew = $('nGuest').checked, roleT = tplHasRole(sel.value);
    nEdInit(); if (nEd) nEd.role(roleT);
    $('nNoVerify').classList.toggle('hidden', !gNew);
    tplPreview($('nTplPrev'), sel.value); deptRow($('nDeptRow'), sel.value, gNew);
    if (rf) $('nDeptRow').classList.add('hidden');
    $('nTeamRow').classList.toggle('hidden', rf || gNew); $('nDeptNote').classList.toggle('hidden', rf || gNew);
    $('nKindRow').classList.toggle('hidden', rf); $('nCodeRow').classList.toggle('hidden', rf); $('nRfNote').classList.toggle('hidden', !rf); $('nRfMinRow').classList.toggle('hidden', !rf);
    $('nTitleRow').classList.toggle('hidden', rf); $('nDateRow').classList.toggle('hidden', rf);   // 비상: 제목·날짜 자동
    $('nCreate').textContent = rf ? '환불 등록 열기' : '서명지 열기';
    $('nRosterBox').classList.toggle('hidden', rf || gNew);   // 명단은 직원 서명지만 (외부인 서명지는 없음)
    nRefill();
  }
  /* 새 서명지 명단: 대상 부서·팀 인원이 자동으로 들어감 (+ 이름으로 추가·✕ 빼기, 부서·팀을 바꿔도 직접 넣고 뺀 것은 남음) */
  var nEd = null, nDir = null, nDirWait = false, nAdd = {}, nDel = {};
  function nEdInit() {
    if (!nEd) {
      nEd = rosterEd($('nEd'), null);
      nEd.onAdd = function (k) { nAdd[k] = 1; delete nDel[k]; };
      nEd.onDel = function (k) { nDel[k] = 1; delete nAdd[k]; };
      nEd.rosterNote = '명단에 있는 사람에게만 서명지가 보입니다. 서명지를 연 뒤에도 [명단 · 임무·역할]에서 추가·뺄 수 있습니다.';
    }
    if (nDir || nDirWait || !isAdm() || !admData) return;
    nDirWait = true;
    srv().withSuccessHandler(function (d) { nDirWait = false; nDir = d.people || []; nEd.setDir(nDir); nRefill(); })
      .withFailureHandler(function (x) { nDirWait = false; msg($('nMsg'), errText(x), '#c0392b'); }).adminStaffDir(staff.token);
  }
  function nRefill() {
    if (!nEd || !nDir) return;
    var ds = $('nDeptRow').classList.contains('hidden') ? [] : mselVal($('nDept')).map(normO), ts = ds.length === 1 ? mselVal($('nTeam')).map(normO) : [];
    nEd.setKeys(nDir.filter(function (p) {
      if (nDel[p.key]) return false;
      if (nAdd[p.key] || !ds.length) return true;   // 부서 [전체] = 모든 직원
      var pd = normO(p.dept);
      return ds.some(function (d) { return pd === d ? !ts.length || ts.indexOf(normO(p.team)) > -1 : !ts.length && normO(p.up) === d; });   // 본부를 고르면 아래 처까지
    }).map(function (p) { return p.key; }));
  }
  function nEdReset() { nAdd = {}; nDel = {}; if (nEd) { nEd.set([]); nRefill(); } }
  $('nTpl').onchange = nTplUi;   // 양식이 바뀌면 명단 읽는 방식도 바뀜 → 동명이인 고르기 다시
  $('nGuest').onchange = nTplUi;
  /** 양식 고르는 칸: 관리자는 양식목록 중 내 등급으로 열 수 있는 양식('01. 이름') + [PDF 서명지], 그 밖의 직원은 [PDF 서명지]만 */
  function nTplFill(list) {
    var sel = $('nTpl'), prev = sel.value, had = sel.options.length > 1; sel.innerHTML = '';
    list.concat([PDF_TPL]).forEach(function (t) { var o = document.createElement('option'); o.value = t; o.textContent = t === PDF_TPL ? 'PDF 서명지 (PDF 올려서 서명받기)' : (admData && admData.tplNames && admData.tplNames[t]) || t; sel.appendChild(o); });
    if (prev && (list.indexOf(prev) > -1 || (prev === PDF_TPL && had))) sel.value = prev;   // 처음 양식을 받으면 첫 양식
    nTplUi();
  }
  /** 서명지 목록 화면에 들어올 때: 새 서명지 열기(직원 모두)·배포용 아이디(관리자)·개인 코드 관리·관리자 지정(2등급 이상) */
  function admCards() {
    var g = !!(staff && staff.guest), adm = isAdm();
    $('newCard').classList.toggle('hidden', g || !(staff && staff.token));
    $('gstCard').classList.toggle('hidden', !adm); $('stCard').classList.toggle('hidden', !adm); $('smCard').classList.toggle('hidden', adm || g || !(staff && staff.token)); $('pcCard').classList.toggle('hidden', admLv() < 2); $('gdCard').classList.toggle('hidden', admLv() < 2);
    if (!adm || !admData) nTplFill([]);
  }
  /** 관리자 작업 응답 그리기. quiet: 처음 받을 때(서명지 목록은 이미 최신) */
  function renderAdmin(d, quiet) {
    if (d && d.patch) {                  // 관리자 작업 응답: 바뀐 카드만 옴 → 가지고 있던 전체 값에 합쳐 다시 그림
      if (!admData) { admCall('adminRefresh', [], renderAdmin); return; }
      d.patch.forEach(function (x) {
        var i = -1; admData.educations.forEach(function (e, k) { if (e.id === x.id) i = k; });
        if (i > -1) admData.educations[i] = x; else admData.educations.push(x);
      });
      if (d.guest) admData.guest = d.guest;
      admData.note = d.note || ''; d = admData;
    }
    admData = d;
    if (d.me) admMe = d.me;
    var nFirst = !$('nDept')._v;   // 처음 그릴 때·서명지를 연 뒤에는 관리자의 부서명·팀, 그 밖에는 고른 값 유지
    deptTeamSel($('nDept'), $('nTeam'), $('nTeamRow'), nFirst ? (admMe && admMe.dept) || '' : mselVal($('nDept')).join(', '), nFirst ? (admMe && admMe.team) || '' : mselVal($('nTeam')).join(', '), nRefill);
    $('gstId').value = (d.guest && d.guest.id) || '';
    nTplFill(d.templates); nRefill();
    if (!d.templates.length) msg($('nMsg'), '열 수 있는 양식이 없습니다. 시트의 양식목록 탭(열 수 있는 등급)을 확인하세요.', '#c0392b');
    if (!$('nDate').value) $('nDate').value = today();
    var note = d.note || ''; d.note = '';   // 안내는 한 번만
    admOverRedraw();
    if (note) admOverMsg(note);
    if (!quiet && staff && staff.token) refreshInit();   // 서명지 목록(제목·마감 등)도 새로
  }
