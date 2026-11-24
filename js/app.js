/* 台灣外傷醫學會專科考題 — 離線練習（純靜態，無外部依賴） */
(function () {
  "use strict";

  var STORE = "trauma-qb-v1";
  var PAGE_SIZE_ALL = 40;
  var PAGE_SIZE_TOPIC = 200;
  var data = window.TRAUMA_QB;
  var main = document.getElementById("main");
  var topicNav = document.getElementById("topicNav");
  var sidebar = document.getElementById("sidebar");
  var backdrop = document.getElementById("backdrop");
  var menuBtn = document.getElementById("menuBtn");
  var searchInput = document.getElementById("searchInput");
  var themeBtn = document.getElementById("themeBtn");

  if (!data || !Array.isArray(data.questions)) {
    main.innerHTML = "<p class=\"empty\">找不到題庫資料（data/questions.js）。請確認檔案完整後再重新開啟。</p>";
    return;
  }

  var byId = Object.create(null);
  data.questions.forEach(function (q) { byId[q.id] = q; });

  var state = {
    view: "home",      // home | all | topic
    topic: null,
    query: "",
    year: "all",       // all | recent | 95–114
    flag: "all",       // all | old | doubt | either | starred
    mode: "practice",  // practice | reveal
    shuffle: false,
    shuffledIds: null,
    page: 1,
    stars: {},
    answers: {},
    open: {}           // manually revealed in reveal mode
  };

  function loadStore() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return;
      var s = JSON.parse(raw);
      if (s.stars && typeof s.stars === "object") state.stars = s.stars;
      if (s.answers && typeof s.answers === "object") state.answers = s.answers;
      if (s.mode === "practice" || s.mode === "reveal") state.mode = s.mode;
    } catch (e) { /* ignore quota / parse errors */ }
  }
  function saveStore() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        stars: state.stars,
        answers: state.answers,
        mode: state.mode
      }));
    } catch (e) { /* private mode / quota */ }
  }

  function applyTheme(theme, persist) {
    var t = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", t);
    themeBtn.setAttribute("aria-label", t === "dark" ? "切換為淺色" : "切換為深色");
    if (persist) {
      try { localStorage.setItem(STORE + "-theme", t); } catch (e) {}
    }
  }
  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(STORE + "-theme"); } catch (e) {}
    if (saved === "light" || saved === "dark") applyTheme(saved, false);
    else applyTheme(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light", false);
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function nl(s) { return esc(s).replace(/\n/g, "<br>"); }

  function topicById(id) {
    for (var i = 0; i < data.topics.length; i++) {
      if (data.topics[i].id === id) return data.topics[i];
    }
    return null;
  }

  function parseHash() {
    var raw = (location.hash || "#/").replace(/^#/, "");
    var parts = raw.split("?");
    var path = parts[0] || "/";
    var qs = {};
    if (parts[1]) {
      parts[1].split("&").forEach(function (pair) {
        var kv = pair.split("=");
        qs[decodeURIComponent(kv[0])] = decodeURIComponent((kv[1] || "").replace(/\+/g, " "));
      });
    }
    if (qs.q != null) state.query = qs.q;
    if (qs.y) state.year = qs.y;
    if (qs.flag) state.flag = qs.flag;
    if (qs.mode === "practice" || qs.mode === "reveal") state.mode = qs.mode;
    if (qs.p) state.page = Math.max(1, parseInt(qs.p, 10) || 1);
    if (path === "/" || path === "") {
      state.view = "home";
      state.topic = null;
    } else if (path === "/all") {
      state.view = "all";
      state.topic = null;
    } else if (path.indexOf("/t/") === 0) {
      state.view = "topic";
      state.topic = decodeURIComponent(path.slice(3));
      if (!topicById(state.topic)) { state.view = "home"; state.topic = null; }
    } else {
      state.view = "home";
      state.topic = null;
    }
  }

  function writeHash(replace) {
    var path = "#/";
    if (state.view === "all") path = "#/all";
    else if (state.view === "topic" && state.topic) path = "#/t/" + encodeURIComponent(state.topic);
    var q = [];
    if (state.query) q.push("q=" + encodeURIComponent(state.query));
    if (state.year && state.year !== "all") q.push("y=" + encodeURIComponent(state.year));
    if (state.flag && state.flag !== "all") q.push("flag=" + encodeURIComponent(state.flag));
    if (state.mode !== "practice") q.push("mode=" + encodeURIComponent(state.mode));
    if (state.page > 1) q.push("p=" + state.page);
    var next = path + (q.length ? "?" + q.join("&") : "");
    if (next === location.hash || (next === "#/" && !location.hash)) return;
    if (replace) history.replaceState(null, "", next);
    else history.pushState(null, "", next);
  }

  function closeNav() {
    document.body.classList.remove("nav-open");
    menuBtn.setAttribute("aria-expanded", "false");
    menuBtn.setAttribute("aria-label", "開啟主題選單");
  }
  function openNav() {
    document.body.classList.add("nav-open");
    menuBtn.setAttribute("aria-expanded", "true");
    menuBtn.setAttribute("aria-label", "關閉主題選單");
  }

  function buildSidebar() {
    document.getElementById("topicAllCount").textContent = data.meta.total;
    topicNav.innerHTML = data.topics.map(function (t, i) {
      var n = String(i + 1).padStart(2, "0");
      return '<a class="topic-link" href="#/t/' + encodeURIComponent(t.id) + '" data-topic="' + esc(t.id) + '">' +
        '<span class="topic-name">' + n + "　" + esc(t.short) + "</span>" +
        '<span class="topic-count">' + t.count + "</span></a>";
    }).join("");
  }

  function highlightSidebar() {
    var links = sidebar.querySelectorAll(".topic-link");
    for (var i = 0; i < links.length; i++) {
      var id = links[i].getAttribute("data-topic");
      var on = (state.view === "all" && id === "all") || (state.view === "topic" && id === state.topic);
      links[i].classList.toggle("is-active", on);
    }
  }

  function yearMatch(q) {
    if (state.year === "all") return true;
    if (state.year === "recent") return q.year >= 110;
    return String(q.year) === String(state.year);
  }
  function flagMatch(q) {
    if (state.flag === "all") return true;
    if (state.flag === "old") return !!q.outdated;
    if (state.flag === "doubt") return !!q.suspect;
    if (state.flag === "either") return !!(q.outdated || q.suspect);
    if (state.flag === "starred") return !!state.stars[q.id];
    return true;
  }
  function queryMatch(q) {
    var s = state.query.trim().toLowerCase();
    if (!s) return true;
    if (q.id.toLowerCase().indexOf(s) !== -1) return true;
    if (("第" + q.qnum + "題").indexOf(s) !== -1) return true;
    if (String(q.year).indexOf(s) !== -1) return true;
    if (q.stem.toLowerCase().indexOf(s) !== -1) return true;
    if ((q.subtopic || "").toLowerCase().indexOf(s) !== -1) return true;
    for (var i = 0; i < q.opts.length; i++) {
      if (q.opts[i].t.toLowerCase().indexOf(s) !== -1) return true;
    }
    return false;
  }

  function filtered() {
    var list = data.questions.filter(function (q) {
      if (state.view === "topic" && q.topic !== state.topic) return false;
      return yearMatch(q) && flagMatch(q) && queryMatch(q);
    });
    if (state.shuffle && state.shuffledIds) {
      var order = Object.create(null);
      state.shuffledIds.forEach(function (id, i) { order[id] = i; });
      list.sort(function (a, b) {
        var ia = order[a.id], ib = order[b.id];
        if (ia == null && ib == null) return 0;
        if (ia == null) return 1;
        if (ib == null) return -1;
        return ia - ib;
      });
    }
    return list;
  }

  function seedShuffle(list) {
    var ids = list.map(function (q) { return q.id; });
    for (var i = ids.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
    }
    state.shuffledIds = ids;
  }

  function renderHome() {
    var answered = Object.keys(state.answers).length;
    var starred = Object.keys(state.stars).filter(function (k) { return state.stars[k]; }).length;
    var stats = [
      [data.meta.total, "題"],
      [data.topics.length, "個主題"],
      ["95–114", "年（20 屆）"],
      [answered + "／" + data.meta.total, "本機已作答"]
    ];
    var html = "";
    html += '<section class="hero">';
    html += '<div><p class="eyebrow">離線練習題庫</p>';
    html += "<h1>台灣外傷醫學會專科考題<br>95–114 年</h1>";
    html += '<p class="lede">這是一份把 95 年至 114 年台灣外傷醫學會專科醫師考試選擇題，依 18 個主題分類後做成的靜態網站，下載後用瀏覽器開啟即可離線練習，也可分享給一起應考的同仁。</p></div>';
    html += '<div class="stat-row">';
    stats.forEach(function (s) {
      html += '<div class="stat"><b>' + esc(String(s[0])) + "</b><span>" + esc(s[1]) + "</span></div>";
    });
    html += "</div></section>";

    html += '<section class="panel"><h2>使用說明</h2><ol>';
    html += "<li>從左側主題目錄（手機請先點選選單）進入單一主題，或開啟「全部題目」。</li>";
    html += "<li>可用年份、關鍵字，以及「過時／存疑／星號」篩選。預設為練習模式：先點選項作答，再顯示對錯與詳解。也可改為「直接看答案」。</li>";
    html += "<li>標有「過時」或「存疑」的題目，詳解會另外說明。考試一律以官方公布答案為準。</li>";
    html += "<li>星號標記與作答紀錄只存在這個瀏覽器的本機（localStorage），不會上傳到任何伺服器。</li>";
    html += "<li>本站為純靜態頁面，不需伺服器；把整個資料夾或壓縮檔傳給同仁，以瀏覽器開啟 <code>index.html</code> 即可。</li>";
    html += "</ol></section>";

    html += '<section class="panel disclaimer"><h2>免責聲明</h2>';
    html += "<p>題目與官方答案整理自既有考題資料；詳解為學習輔助整理，並非官方解答。部分題目的觀念可能已過時，或答案存有疑義，已分別標示。應考與臨床決策請以官方公布答案及最新指引為準。本站僅供學習使用。</p>";
    html += "<p>目前題庫共 " + data.meta.total + " 題，其中「過時」" + data.meta.outdated + " 題、「存疑」" + data.meta.suspect + " 題（部分題目兩者皆有）。附圖 " + data.meta.images + " 題已一併打包。</p>";
    if (starred) html += "<p>你目前標記了 " + starred + " 題星號。</p>";
    html += "</section>";

    html += "<h2 class=\"view-title\" style=\"margin:8px 0 4px\">依主題開始</h2>";
    html += '<div class="topic-grid">';
    data.topics.forEach(function (t, i) {
      var n = String(i + 1).padStart(2, "0");
      html += '<a class="topic-card" href="#/t/' + encodeURIComponent(t.id) + '">';
      html += '<span class="no">' + n + "</span>";
      html += '<span class="nm">' + esc(t.name) + "</span>";
      html += '<span class="ct">' + t.count + " 題</span></a>";
    });
    html += "</div>";
    main.innerHTML = html;
  }

  function yearOptions() {
    var html = '<option value="all">全部年份</option>';
    html += '<option value="recent">近 5 年（110–114）</option>';
    data.meta.years.forEach(function (y) {
      html += '<option value="' + y + '">' + y + " 年</option>";
    });
    return html;
  }

  function renderCard(q, mode) {
    var rec = state.answers[q.id];
    var answered = !!(rec && rec.pick);
    var opened = mode === "reveal" && (state.open[q.id] || answered);
    var showAns = (mode === "practice" && answered) || opened;
    var cls = "q-card";
    if (showAns) cls += " is-open";
    if (answered) cls += " is-answered";
    var html = '<article class="' + cls + '" id="q-' + esc(q.id) + '" data-id="' + esc(q.id) + '">';
    html += '<div class="q-head">';
    html += '<span class="qid">' + esc(q.id) + "</span>";
    if (q.outdated) html += '<span class="badge badge-old">過時</span>';
    if (q.suspect) html += '<span class="badge badge-doubt">存疑</span>';
    if (q.subtopic) html += '<span class="subtopic">' + esc(q.subtopic) + "</span>";
    html += '<button type="button" class="star-btn' + (state.stars[q.id] ? " is-on" : "") + '" data-act="star" aria-pressed="' + (state.stars[q.id] ? "true" : "false") + '" aria-label="' + (state.stars[q.id] ? "取消星號" : "加上星號") + '">' + (state.stars[q.id] ? "★" : "☆") + "</button>";
    html += "</div>";
    html += '<p class="stem">' + nl(q.stem) + "</p>";
    if (q.images && q.images.length) {
      q.images.forEach(function (src) {
        html += '<div class="fig"><img src="media/' + esc(src) + '" alt="原卷附圖（' + esc(q.id) + '）" loading="lazy"></div>';
      });
    }
    html += '<div class="opts">';
    q.opts.forEach(function (opt) {
      var ocls = "opt-btn";
      var mark = "";
      if (showAns) {
        if (opt.k === q.answer) { ocls += " is-correct"; mark = "正解"; }
        if (answered && rec.pick === opt.k && opt.k !== q.answer) { ocls += " is-wrong"; mark = "你的作答"; }
      }
      var attrDisabled = (mode === "practice" && answered) ? " disabled" : "";
      if (mode === "reveal") {
        // options are not buttons for answering
        html += '<div class="' + ocls + '" role="group"><span class="opt-key">(' + esc(opt.k) + ")</span><span class=\"opt-text\">" + nl(opt.t) + "</span>" + (mark ? '<span class="opt-mark">' + mark + "</span>" : "") + "</div>";
      } else {
        html += '<button type="button" class="' + ocls + '" data-act="answer" data-k="' + esc(opt.k) + '"' + attrDisabled + '><span class="opt-key">(' + esc(opt.k) + ")</span><span class=\"opt-text\">" + nl(opt.t) + "</span>" + (mark ? '<span class="opt-mark">' + mark + "</span>" : "") + "</button>";
      }
    });
    html += "</div>";

    html += '<div class="q-actions">';
    if (mode === "reveal" && !opened) {
      html += '<button type="button" class="btn" data-act="open">顯示答案與詳解</button>';
    } else if (mode === "reveal" && opened) {
      html += '<button type="button" class="btn btn-ghost" data-act="close">隱藏答案</button>';
    }
    if (mode === "practice" && answered) {
      html += '<button type="button" class="btn btn-ghost" data-act="retry">重作此題</button>';
    }
    html += "</div>";

    html += '<div class="reveal">';
    if (mode === "practice" && answered) {
      var ok = rec.pick === q.answer;
      html += '<div class="ans-bar ' + (ok ? "ok" : "bad") + '">' + (ok ? "答對。" : "答錯。") + " 官方答案：(" + esc(q.answer) + ")</div>";
    } else {
      html += '<div class="ans-bar">官方答案：(' + esc(q.answer) + ")</div>";
    }
    html += '<div class="expl"><h3>詳解</h3><div>' + (q.expl ? nl(q.expl) : "無詳解") + "</div></div>";
    if (q.outdated || q.suspect) {
      var fcls = "flag-box";
      var title = "";
      if (q.outdated && q.suspect) { fcls += " both"; title = "觀念已過時，且答案存疑"; }
      else if (q.outdated) { fcls += " old"; title = "觀念已過時"; }
      else { fcls += " doubt"; title = "答案存疑"; }
      html += '<div class="' + fcls + '"><h3>' + title + "</h3><div>" + (q.flagNote ? nl(q.flagNote) : "") + "</div>";
      html += '<p class="official-note">考試以官方答案為準。</p></div>';
    } else if (showAns) {
      html += '<p class="official-note">詳解為整理輔助，答案以官方公布為準。</p>';
    }
    html += "</div></article>";
    return html;
  }

  function renderList() {
    var list = filtered();
    var topic = state.topic ? topicById(state.topic) : null;
    var title = state.view === "topic" && topic ? topic.name : "全部題目";
    var sub = state.view === "topic" && topic ? topic.short + " ・ " + topic.count + " 題" : "18 個主題 ・ " + data.meta.total + " 題";

    var pageSize = (state.view === "topic" && !state.query) ? PAGE_SIZE_TOPIC : PAGE_SIZE_ALL;
    var totalPages = Math.max(1, Math.ceil(list.length / pageSize));
    if (state.page > totalPages) state.page = totalPages;
    var start = (state.page - 1) * pageSize;
    var pageItems = list.slice(start, start + pageSize);

    var html = "";
    html += '<div class="toolbar">';
    html += '<h1 class="view-title">' + esc(title) + "<small>" + esc(sub) + "</small></h1>";
    html += '<select class="filter-select" id="yearFilter" aria-label="年份">' + yearOptions() + "</select>";
    html += '<select class="filter-select" id="flagFilter" aria-label="標記篩選">';
    html += '<option value="all">全部標記</option>';
    html += '<option value="old">只看過時（' + data.meta.outdated + "）</option>";
    html += '<option value="doubt">只看存疑（' + data.meta.suspect + "）</option>";
    html += '<option value="either">過時或存疑</option>';
    html += '<option value="starred">只看星號</option>';
    html += "</select>";
    html += '<button type="button" class="btn" id="modeBtn" aria-pressed="' + (state.mode === "practice" ? "true" : "false") + '">' +
      (state.mode === "practice" ? "練習模式" : "直接看答案") + "</button>";
    html += '<button type="button" class="btn" id="shuffleBtn" aria-pressed="' + (state.shuffle ? "true" : "false") + '">' +
      (state.shuffle ? "取消隨機" : "隨機排序") + "</button>";
    html += "</div>";

    var filterBits = [];
    if (state.query) filterBits.push("關鍵字「" + state.query + "」");
    if (state.year === "recent") filterBits.push("近 5 年");
    else if (state.year !== "all") filterBits.push(state.year + " 年");
    if (state.flag === "old") filterBits.push("只看過時");
    if (state.flag === "doubt") filterBits.push("只看存疑");
    if (state.flag === "either") filterBits.push("過時或存疑");
    if (state.flag === "starred") filterBits.push("只看星號");
    if (state.shuffle) filterBits.push("隨機排序");
    var meta = "共 " + list.length + " 題";
    if (filterBits.length) meta += "（" + filterBits.join("、") + "）";
    if (list.length > pageSize) meta += "，目前第 " + state.page + "／" + totalPages + " 頁";
    html += '<p class="result-meta">' + esc(meta) + "</p>";

    if (!list.length) {
      html += '<p class="empty">沒有符合條件的題目。試試清除搜尋或放寬篩選。</p>';
      main.innerHTML = html;
      bindToolbar();
      return;
    }

    if (list.length > pageSize) html += pager(state.page, totalPages, list.length);
    html += '<div class="q-list">';
    pageItems.forEach(function (q) { html += renderCard(q, state.mode); });
    html += "</div>";
    if (list.length > pageSize) html += pager(state.page, totalPages, list.length);
    main.innerHTML = html;
    bindToolbar();
  }

  function pager(page, total, count) {
    return '<div class="pager">' +
      '<button type="button" class="btn" data-page="' + (page - 1) + '"' + (page <= 1 ? " disabled" : "") + ">上一頁</button>" +
      "<span>第 " + page + "／" + total + " 頁（" + count + " 題）</span>" +
      '<button type="button" class="btn" data-page="' + (page + 1) + '"' + (page >= total ? " disabled" : "") + ">下一頁</button></div>";
  }

  function bindToolbar() {
    var y = document.getElementById("yearFilter");
    var f = document.getElementById("flagFilter");
    if (y) {
      y.value = state.year;
      y.addEventListener("change", function () {
        state.year = y.value;
        state.page = 1;
        state.shuffledIds = null;
        if (state.shuffle) seedShuffle(filteredBase());
        writeHash(false);
        render();
      });
    }
    if (f) {
      f.value = state.flag;
      f.addEventListener("change", function () {
        state.flag = f.value;
        state.page = 1;
        state.shuffledIds = null;
        if (state.shuffle) seedShuffle(filteredBase());
        writeHash(false);
        render();
      });
    }
    var modeBtn = document.getElementById("modeBtn");
    if (modeBtn) modeBtn.addEventListener("click", function () {
      state.mode = state.mode === "practice" ? "reveal" : "practice";
      saveStore();
      writeHash(true);
      render();
    });
    var sh = document.getElementById("shuffleBtn");
    if (sh) sh.addEventListener("click", function () {
      state.shuffle = !state.shuffle;
      state.page = 1;
      if (state.shuffle) seedShuffle(filteredBase());
      else state.shuffledIds = null;
      writeHash(true);
      render();
      window.scrollTo(0, 0);
    });
    var pagers = main.querySelectorAll(".pager .btn");
    for (var i = 0; i < pagers.length; i++) {
      pagers[i].addEventListener("click", function (e) {
        var p = parseInt(e.currentTarget.getAttribute("data-page"), 10);
        if (!p) return;
        state.page = p;
        writeHash(false);
        render();
        window.scrollTo(0, 0);
      });
    }
  }

  function filteredBase() {
    var sh = state.shuffle;
    var ids = state.shuffledIds;
    state.shuffle = false;
    state.shuffledIds = null;
    var list = filtered();
    state.shuffle = sh;
    state.shuffledIds = ids;
    return list;
  }

  function refreshCard(card, q) {
    var wrap = document.createElement("div");
    wrap.innerHTML = renderCard(q, state.mode);
    card.replaceWith(wrap.firstElementChild);
  }

  main.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-act]");
    if (!btn || !main.contains(btn)) return;
    var card = btn.closest(".q-card");
    if (!card) return;
    var id = card.getAttribute("data-id");
    var q = byId[id];
    if (!q) return;
    var act = btn.getAttribute("data-act");
    if (act === "star") {
      if (state.stars[id]) delete state.stars[id];
      else state.stars[id] = true;
      saveStore();
      if (state.flag === "starred") { render(); return; }
      btn.classList.toggle("is-on", !!state.stars[id]);
      btn.setAttribute("aria-pressed", state.stars[id] ? "true" : "false");
      btn.setAttribute("aria-label", state.stars[id] ? "取消星號" : "加上星號");
      btn.textContent = state.stars[id] ? "★" : "☆";
      return;
    }
    if (act === "answer" && state.mode === "practice") {
      if (state.answers[id] && state.answers[id].pick) return;
      state.answers[id] = { pick: btn.getAttribute("data-k"), ts: Date.now() };
      saveStore();
      refreshCard(card, q);
      return;
    }
    if (act === "retry") {
      delete state.answers[id];
      saveStore();
      refreshCard(card, q);
      return;
    }
    if (act === "open") {
      state.open[id] = true;
      refreshCard(card, q);
      return;
    }
    if (act === "close") {
      delete state.open[id];
      refreshCard(card, q);
      return;
    }
  });

  function render() {
    highlightSidebar();
    if (state.view === "home" && !state.query) {
      renderHome();
    } else {
      if (state.view === "home") {
        // searching from home → show all matches
        state.view = "all";
        writeHash(true);
      }
      renderList();
    }
    searchInput.classList.toggle("has-value", !!state.query);
    var box = searchInput.closest(".search-box");
    if (box) box.classList.toggle("has-value", !!state.query);
    closeNav();
  }

  var searchTimer = null;
  searchInput.addEventListener("input", function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      state.query = searchInput.value;
      state.page = 1;
      if (state.shuffle) { state.shuffledIds = null; seedShuffle(filteredBase()); }
      writeHash(true);
      render();
    }, 180);
  });
  searchInput.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      searchInput.value = "";
      state.query = "";
      state.page = 1;
      writeHash(true);
      render();
    }
  });

  themeBtn.addEventListener("click", function () {
    var cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    applyTheme(cur === "dark" ? "light" : "dark", true);
  });
  menuBtn.addEventListener("click", function () {
    if (document.body.classList.contains("nav-open")) closeNav();
    else openNav();
  });
  backdrop.addEventListener("click", closeNav);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && document.body.classList.contains("nav-open")) closeNav();
  });

  window.addEventListener("hashchange", function () {
    var prevShuffle = state.shuffle;
    var prevIds = state.shuffledIds;
    var prevPage = state.page;
    parseHash();
    searchInput.value = state.query;
    // keep shuffle only if still in a list view
    state.shuffle = prevShuffle;
    state.shuffledIds = prevIds;
    if (state.view === "home" && !state.query) {
      state.shuffle = false;
      state.shuffledIds = null;
    }
    render();
  });

  document.getElementById("brandLink").addEventListener("click", function () {
    state.query = "";
    searchInput.value = "";
    state.year = "all";
    state.flag = "all";
    state.page = 1;
    state.shuffle = false;
    state.shuffledIds = null;
  });

  initTheme();
  loadStore();
  buildSidebar();
  parseHash();
  searchInput.value = state.query;
  render();
})();
