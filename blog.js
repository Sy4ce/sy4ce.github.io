/* ==========================================================================
   Syfice — blog
   Reads the post index from pages/pages.json:

     [
       {
         "path":  "article.md",         // 相对 pages/ 目录，也可写 pages/article.md
         "date":  "2026-10-20",         // YYYY-MM-DD
         "title": "文章标题",
         "desc":  "一句介绍"
       }
     ]

   blog.html renders the list; post.html reads ?p=<path> and renders the
   markdown with marked (vendor/marked.min.js). No other dependencies.
   ========================================================================== */
(function () {
  'use strict';

  var INDEX_URL = 'pages/pages.json';

  function byId(id) { return document.getElementById(id); }

  /* --------------------------------------------------------------------
     helpers
     -------------------------------------------------------------------- */
  function fetchText(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' — ' + url);
      return res.text();
    });
  }

  function fetchIndex() {
    return fetchText(INDEX_URL).then(function (text) {
      var data = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error('pages.json 的顶层应该是数组');
      return data.map(normalize).filter(Boolean);
    });
  }

  // Keep only entries we can safely fetch and render.
  function normalize(p) {
    if (!p || typeof p !== 'object') return null;

    var path = typeof p.path === 'string' ? p.path.trim() : '';
    if (!path) return null;
    if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(path)) return null;  // external
    path = path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (path.indexOf('pages/') !== 0) path = 'pages/' + path;     // relative to pages.json
    if (path.split('/').indexOf('..') !== -1) return null;        // traversal

    return {
      path: path,
      date: typeof p.date === 'string' ? p.date : '',
      title: typeof p.title === 'string' ? p.title : '',
      desc: typeof p.desc === 'string' ? p.desc : ''
    };
  }

  function dateParts(value) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value || '');
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { y: y, m: mo, d: d, key: Date.UTC(y, mo - 1, d) };
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function dateLabel(parts) {
    return parts ? parts.y + '.' + pad2(parts.m) + '.' + pad2(parts.d) : '—';
  }

  function dateISO(parts) {
    return parts ? parts.y + '-' + pad2(parts.m) + '-' + pad2(parts.d) : '';
  }

  function postURL(post) {
    return 'post.html?p=' + encodeURIComponent(post.path);
  }

  function setStatus(el, message, isError) {
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
    el.classList.toggle('is-error', !!isError);
  }

  function failMessage(err) {
    if (location.protocol === 'file:') {
      return '无法读取 ' + INDEX_URL + '：浏览器不允许 file:// 页面发起 fetch。' +
             '请通过本地 HTTP 服务器访问本站，例如在仓库目录运行 python -m http.server。';
    }
    return '内容加载失败：' + (err && err.message ? err.message : '未知错误');
  }

  /* --------------------------------------------------------------------
     blog.html — list
     -------------------------------------------------------------------- */
  function sortPosts(posts) {
    return posts.sort(function (a, b) {
      var da = dateParts(a.date), db = dateParts(b.date);
      var ka = da ? da.key : -Infinity, kb = db ? db.key : -Infinity;
      if (ka !== kb) return kb - ka;
      return a.title.localeCompare(b.title, 'zh-Hans-CN');
    });
  }

  // The rows are created after script.js has observed the static page,
  // so reveal them here instead of waiting for a scroll event.
  function revealRows(list) {
    var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
    raf(function () {
      raf(function () {
        Array.prototype.forEach.call(list.children, function (li) {
          li.classList.add('is-in');
        });
      });
    });
  }

  function initList() {
    var list = byId('post-list');
    var status = byId('post-status');
    if (!list) return;

    setStatus(status, '正在载入文章…');

    fetchIndex().then(function (posts) {
      sortPosts(posts);

      if (!posts.length) {
        setStatus(status, '还没有文章。在 pages/pages.json 里添加一条配置即可。');
        return;
      }

      list.textContent = '';
      posts.forEach(function (post, i) {
        list.appendChild(postRow(post, i));
      });

      setStatus(status, '');
      revealRows(list);
    }).catch(function (err) {
      setStatus(status, failMessage(err), true);
    });
  }

  /* --------------------------------------------------------------------
     index.html — latest posts teaser
     -------------------------------------------------------------------- */
  function initHome() {
    var list = byId('home-posts');
    if (!list) return;

    var status = byId('home-posts-status');

    fetchIndex().then(function (posts) {
      sortPosts(posts);

      if (!posts.length) {
        setStatus(status, '还没有文章。');
        return;
      }

      posts.slice(0, 2).forEach(function (post, i) {
        list.appendChild(postRow(post, i));
      });
      revealRows(list);
    }).catch(function () {
      // 主页不展示错误信息，保留「全部文章」按钮作为入口即可
      list.hidden = true;
      if (status) status.hidden = true;
    });
  }

  function postRow(post, index) {
    var parts = dateParts(post.date);

    var li = document.createElement('li');
    li.className = 'postrow';
    li.setAttribute('data-reveal', '');
    li.style.setProperty('--d', String(Math.min(index, 5)));

    var a = document.createElement('a');
    a.className = 'postrow__link';
    a.href = postURL(post);

    var num = document.createElement('span');
    num.className = 'postrow__num';
    num.textContent = pad2(index + 1);

    var time = document.createElement('time');
    time.className = 'postrow__date';
    time.textContent = dateLabel(parts);
    if (parts) time.dateTime = dateISO(parts);

    var body = document.createElement('span');
    body.className = 'postrow__body';

    var title = document.createElement('span');
    title.className = 'postrow__title';
    title.textContent = post.title || '无标题';
    body.appendChild(title);

    if (post.desc) {
      var desc = document.createElement('span');
      desc.className = 'postrow__desc';
      desc.textContent = post.desc;
      body.appendChild(desc);
    }

    var go = document.createElement('span');
    go.className = 'postrow__go';
    go.setAttribute('aria-hidden', 'true');
    go.textContent = '阅读';

    a.appendChild(num);
    a.appendChild(time);
    a.appendChild(body);
    a.appendChild(go);
    li.appendChild(a);
    return li;
  }

  /* --------------------------------------------------------------------
     post.html — article
     -------------------------------------------------------------------- */
  function initPost() {
    var article = byId('post-body');
    var status = byId('post-status');
    if (!article) return;

    var head = byId('post-head');
    var foot = byId('post-foot');
    var titleEl = byId('post-title');
    var descEl = byId('post-desc');
    var metaEl = byId('post-meta');

    setStatus(status, '正在载入文章…');

    var key = '';
    try {
      key = new URLSearchParams(location.search).get('p') || '';
    } catch (err) {
      key = '';
    }

    fetchIndex().then(function (posts) {
      var post = findPost(posts, key);
      if (!post) throw new Error('文章不存在，或尚未在 pages/pages.json 中配置。');

      return fetchText(post.path).then(function (markdown) {
        if (!window.marked || typeof window.marked.parse !== 'function') {
          throw new Error('Markdown 渲染器没有加载（vendor/marked.min.js）。');
        }

        article.innerHTML = window.marked.parse(markdown, {
          gfm: true,
          breaks: false
        });

        // The page title is configured in pages.json, so a leading H1 in the
        // markdown would repeat it verbatim. Drop that first heading only.
        var first = article.firstElementChild;
        if (first && first.tagName === 'H1') first.parentNode.removeChild(first);

        enhance(article, post.path);
        fillHead(post, markdown, metaEl, titleEl, descEl);

        var displayTitle = post.title || '无标题';
        document.title = displayTitle + ' — Syfice Blogs';

        setMeta('name', 'description', post.desc);
        setMeta('property', 'og:title', displayTitle + ' — Syfice');
        setMeta('property', 'og:description', post.desc);

        setStatus(status, '');
        if (head) head.hidden = false;
        if (foot) foot.hidden = false;
        article.hidden = false;

        var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
        raf(function () { article.classList.add('is-in'); });
      });
    }).catch(function (err) {
      document.title = '文章未找到 — Syfice';
      setStatus(status, failMessage(err), true);
    });
  }

  function findPost(posts, key) {
    var k = String(key || '').trim().replace(/^\/+/, '');
    if (!k) return null;

    for (var i = 0; i < posts.length; i++) {
      var path = posts[i].path;
      if (path === k || path.split('/').pop() === k) return posts[i];
    }
    return null;
  }

  function fillHead(post, markdown, metaEl, titleEl, descEl) {
    var parts = dateParts(post.date);

    if (metaEl) {
      metaEl.textContent = '';

      var time = document.createElement('time');
      time.textContent = dateLabel(parts);
      if (parts) time.dateTime = dateISO(parts);
      metaEl.appendChild(time);

      var dot = document.createElement('span');
      dot.className = 'post__dot';
      dot.setAttribute('aria-hidden', 'true');
      dot.textContent = '·';

      var read = document.createElement('span');
      read.textContent = '约 ' + readingMinutes(markdown) * 4 + ' 分钟';

      metaEl.appendChild(dot);
      metaEl.appendChild(read);
    }

    if (titleEl) titleEl.textContent = post.title || '无标题';

    if (descEl) {
      if (post.desc) {
        descEl.textContent = post.desc;
        descEl.hidden = false;
      } else {
        descEl.hidden = true;
      }
    }
  }

  function readingMinutes(markdown) {
    var plain = String(markdown || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/~~~[\s\S]*?~~~/g, ' ')
      .replace(/`[^`\n]*`/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[#>*_~|=-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    var cjk = (plain.match(/[㐀-鿿豈-﫿]/g) || []).length;
    var words = (plain.replace(/[㐀-鿿豈-﫿]/g, ' ')
                      .match(/[A-Za-z0-9][A-Za-z0-9'’._-]*/g) || []).length;

    return Math.max(1, Math.ceil(cjk / 400 + words / 200));
  }

  function setMeta(attr, name, value) {
    if (!value) return;
    var el = document.querySelector('meta[' + attr + '="' + name + '"]');
    if (el) el.setAttribute('content', value);
  }

  /* --------------------------------------------------------------------
     article post-processing
     -------------------------------------------------------------------- */
  function enhance(root, postPath) {
    var base = new URL(postPath, location.href);
    var usedIds = {};

    Array.prototype.forEach.call(root.querySelectorAll('h1,h2,h3,h4'), function (h) {
      if (h.id) { usedIds[h.id] = true; return; }
      var id = slugify(h.textContent);
      if (usedIds[id]) {
        var n = 2;
        while (usedIds[id + '-' + n]) n++;
        id = id + '-' + n;
      }
      usedIds[id] = true;
      h.id = id;
    });

    Array.prototype.forEach.call(root.querySelectorAll('img[src]'), function (img) {
      try {
        img.src = new URL(img.getAttribute('src'), base).href;
      } catch (err) { /* leave as authored */ }
      img.loading = 'lazy';
      img.decoding = 'async';
    });

    Array.prototype.forEach.call(root.querySelectorAll('a[href]'), function (a) {
      var raw = a.getAttribute('href');
      if (!raw || raw.charAt(0) === '#') return;
      if (/^(?:mailto:|tel:|javascript:)/i.test(raw)) return;

      var url;
      try {
        url = new URL(raw, base);
      } catch (err) {
        return;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

      a.href = url.href;
      if (url.origin !== location.origin) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
    });

    Array.prototype.forEach.call(root.querySelectorAll('table'), function (table) {
      if (table.parentNode && table.parentNode.classList.contains('prose__scroll')) return;
      var scroller = document.createElement('div');
      scroller.className = 'prose__scroll';
      table.parentNode.insertBefore(scroller, table);
      scroller.appendChild(table);
    });

    Array.prototype.forEach.call(root.querySelectorAll('pre'), function (pre) {
      var code = pre.querySelector('code');
      if (!code) return;

      var shell = document.createElement('div');
      shell.className = 'prose__code';
      pre.parentNode.insertBefore(shell, pre);
      shell.appendChild(pre);

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'codecopy';
      btn.textContent = '复制';
      btn.setAttribute('aria-label', '复制代码');
      btn.addEventListener('click', function () {
        copyText(code.textContent).then(function () {
          flash('已复制', true);
        }, function () {
          flash('复制失败', false);
        });
      });
      shell.appendChild(btn);

      function flash(label, ok) {
        var original = '复制';
        btn.textContent = label;
        btn.classList.toggle('is-done', ok);
        window.setTimeout(function () {
          btn.textContent = original;
          btn.classList.remove('is-done');
        }, 1600);
      }
    });
  }

  function slugify(text) {
    var id = String(text || '')
      .trim()
      .toLowerCase()
      .replace(/[^\w㐀-鿿豈-﫿-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return id || 'section';
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () {
        return legacyCopy(text);
      });
    }
    return legacyCopy(text);
  }

  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();

      var ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      document.body.removeChild(ta);

      if (ok) resolve();
      else reject(new Error('copy failed'));
    });
  }

  /* --------------------------------------------------------------------
     boot
     -------------------------------------------------------------------- */
  function boot() {
    if (byId('post-list')) initList();
    if (byId('home-posts')) initHome();
    if (byId('post-body')) initPost();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
