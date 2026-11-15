/* FDH_STOCK · cola local de movimientos de stock hacia el libro "Stock" del servidor (etapa 1, modo sombra).
   Cada movimiento (venta, entrega, ingreso, ajuste, apertura, recuento) se guarda PRIMERO en el dispositivo con un ID unico
   y se manda al servidor en segundo plano; el mostrador nunca espera. Si no hay internet o el servidor no contesta, queda en
   la cola y se reenvia solo (con espera creciente), con el MISMO ID: el servidor nunca duplica. Nada se descarta salvo
   lo que el servidor rechaza por invalido (queda aparte, a la vista).
   API: FDH_STOCK.url = '<endpoint>'; FDH_STOCK.registrar({tipo, referencia, quien, turnoDe, turno, deltas, contado, motivo, detalle})
        FDH_STOCK.estado() -> {pendientes, rechazados, enviando, ultimoOk, saldos}; FDH_STOCK.onCambio(fn); FDH_STOCK.reintentarYa()
   Configuracion de pruebas: window.FDH_STOCK_CFG = {timeoutMs, esperas, arranqueMs}. */
(function (w) {
  var K_COLA = 'fdh_stock_cola_v1', K_RECH = 'fdh_stock_rech_v1', K_DISP = 'fdh_stock_disp_v1', K_ULT = 'fdh_stock_ult_v1';
  var CFG = { timeoutMs: 25000, esperas: [3000, 10000, 30000, 60000, 120000, 300000], arranqueMs: 1500, maxRech: 50, demoraMs: 120000 };
  var g = w.FDH_STOCK_CFG || {}, k;
  for (k in g) CFG[k] = g[k];
  var mem = {}, oyentes = [], enviando = false, intentos = 0, timer = null, ultimoOk = 0, saldos = null;

  function leer(clave, def) {
    try { var s = w.localStorage.getItem(clave); if (s) return JSON.parse(s); } catch (e) {}
    return mem[clave] !== undefined ? JSON.parse(JSON.stringify(mem[clave])) : def;
  }
  function guardar(clave, v) {
    mem[clave] = JSON.parse(JSON.stringify(v));
    try { w.localStorage.setItem(clave, JSON.stringify(v)); } catch (e) {}
  }
  function rnd(n) { var s = ''; while (s.length < n) s += Math.random().toString(36).slice(2); return s.slice(0, n); }
  function dispositivo() {
    var d = leer(K_DISP, null);
    if (!d || typeof d !== 'string') { d = rnd(4); guardar(K_DISP, d); }
    return d;
  }
  function nuevoId() { return 'm' + Date.now().toString(36) + rnd(6) + dispositivo(); }
  function hhmm(t) { var d = new Date(t); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }

  function estado() {
    return { pendientes: leer(K_COLA, []).length, rechazados: leer(K_RECH, []).length, enviando: enviando, ultimoOk: ultimoOk, saldos: saldos };
  }
  function avisar() { var e = estado(); oyentes.forEach(function (f) { try { f(e); } catch (x) {} }); }
  function programar(ms) { clearTimeout(timer); timer = setTimeout(enviar, ms); }
  function sacar(id) { guardar(K_COLA, leer(K_COLA, []).filter(function (x) { return x.id !== id; })); }
  function rechazar(m, error) {
    var r = leer(K_RECH, []); r.push({ m: m, error: String(error || ''), t: Date.now() });
    guardar(K_RECH, r.slice(-CFG.maxRech)); sacar(m.id);
  }
  function fallo() {
    intentos++; avisar();
    programar(CFG.esperas[Math.min(intentos - 1, CFG.esperas.length - 1)]);
  }

  function enviar() {
    if (enviando || !FDH_STOCK.url) return;
    var cola = leer(K_COLA, []);
    if (!cola.length) { avisar(); return; }
    var m = cola[0]; enviando = true; avisar();
    var detalle = String(m.detalle || '');
    if (Date.now() - m.t > CFG.demoraMs) detalle += ' · ⏱ hecho a las ' + hhmm(m.t);   // el servidor sella la hora de llegada
    var cuerpo = { accion: 'stockMovimiento', id: m.id, tipo: m.tipo, referencia: m.referencia || '', quien: m.quien || '',
                   turnoDe: m.turnoDe || '', turno: m.turno || '', deltas: m.deltas || {}, contado: m.contado || {},
                   motivo: m.motivo || '', detalle: detalle };
    var ac = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var tm = setTimeout(function () { if (ac) { try { ac.abort(); } catch (e) {} } }, CFG.timeoutMs);
    var opt = { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(cuerpo) };
    if (ac) opt.signal = ac.signal;
    fetch(FDH_STOCK.url, opt)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (tx) { try { return JSON.parse(tx); } catch (e) { throw new Error('respuesta ilegible'); } })
      .then(function (j) {
        clearTimeout(tm); enviando = false;
        if (j && j.ok) {                                   // registrado (o "repetido": ya estaba)
          sacar(m.id); intentos = 0; ultimoOk = Date.now();
          if (j.saldos) { saldos = j.saldos; guardar(K_ULT, { t: ultimoOk, saldos: saldos }); }
          avisar(); programar(0);
        } else if (j && j.codigo === 'invalido') {         // el servidor lo rechaza por mal armado: no se reintenta
          rechazar(m, j.error); intentos = 0; avisar(); programar(0);
        } else { fallo(); }                                 // sin hoja, candado ocupado, etc.: se reintenta
      })
      .catch(function () { clearTimeout(tm); enviando = false; fallo(); });
  }

  /** POST directo (fuera de la cola) con espera: se usa cuando el servidor tiene que decidir en el momento (codigo de socio).
      Resuelve con la respuesta JSON (ok:true, o ok:false con motivo/error); rechaza si no hay conexion, si tarda mas de timeoutMs o si no es JSON. */
  function enviarDirecto(cuerpo) {
    return new Promise(function (resolve, reject) {
      var ac = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var tm = setTimeout(function () { if (ac) { try { ac.abort(); } catch (e) {} } reject(new Error('tiempo agotado')); }, CFG.directoMs || 20000);
      var opt = { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(cuerpo) };
      if (ac) opt.signal = ac.signal;
      fetch(FDH_STOCK.url, opt)
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (tx) { clearTimeout(tm); try { resolve(JSON.parse(tx)); } catch (e) { reject(new Error('respuesta ilegible')); } })
        .catch(function (e) { clearTimeout(tm); reject(e); });
    });
  }

  var FDH_STOCK = {
    url: '',
    nuevoId: nuevoId,
    /** Manda UN movimiento SIN pasar por la cola, con el codigo de un socio. El codigo va en el pedido y no se guarda en ningun lado.
        El movimiento conserva su id: si se reintenta (por ejemplo tras un corte), el servidor no lo duplica. */
    confirmar: function (mov, socio) {
      if (!mov.id) mov.id = nuevoId();
      return enviarDirecto({ accion: 'stockMovimiento', id: mov.id, tipo: mov.tipo, referencia: mov.referencia || '', quien: mov.quien || '',
        turnoDe: mov.turnoDe || '', turno: mov.turno || '', deltas: mov.deltas || {}, contado: mov.contado || {}, motivo: mov.motivo || '',
        detalle: mov.detalle || '', socio: { nombre: socio.nombre, codigo: socio.codigo } });
    },
    /** Solo verifica nombre y codigo de un socio (por ejemplo para habilitar la correccion de la apertura). */
    verificarSocio: function (socio) { return enviarDirecto({ accion: 'socioVerificar', nombre: socio.nombre, codigo: socio.codigo }); },
    /** Lee si la regla de socio esta activa en el servidor (GET ?estado=stock). Resuelve {ok, modo, exigirSocio}. */
    regla: function () {
      return new Promise(function (resolve, reject) {
        var ac = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var tm = setTimeout(function () { if (ac) { try { ac.abort(); } catch (e) {} } reject(new Error('tiempo agotado')); }, CFG.reglaMs || 8000);
        var opt = { cache: 'no-store' }; if (ac) opt.signal = ac.signal;
        fetch(FDH_STOCK.url + (FDH_STOCK.url.indexOf('?') < 0 ? '?' : '&') + 'estado=stock', opt)
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
          .then(function (tx) { clearTimeout(tm); try { resolve(JSON.parse(tx)); } catch (e) { reject(new Error('respuesta ilegible')); } })
          .catch(function (e) { clearTimeout(tm); reject(e); });
      });
    },
    registrar: function (mov) {
      var m = {};
      ['tipo', 'referencia', 'quien', 'turnoDe', 'turno', 'deltas', 'contado', 'motivo', 'detalle'].forEach(function (c) { if (mov[c] !== undefined) m[c] = mov[c]; });
      m.id = nuevoId(); m.t = Date.now();
      var cola = leer(K_COLA, []); cola.push(m); guardar(K_COLA, cola);   // primero se guarda en el dispositivo
      avisar(); programar(0);
      return m.id;
    },
    estado: estado,
    onCambio: function (f) { oyentes.push(f); },
    reintentarYa: function () { intentos = 0; programar(0); },
    rechazados: function () { return leer(K_RECH, []); },
    ultimosSaldos: function () { var u = leer(K_ULT, null); return u ? u.saldos : null; }
  };
  w.FDH_STOCK = FDH_STOCK;

  try { w.addEventListener('online', function () { intentos = 0; programar(0); }); } catch (e) {}
  try { document.addEventListener('visibilitychange', function () { if (!document.hidden && leer(K_COLA, []).length) { intentos = 0; programar(0); } }); } catch (e) {}
  setTimeout(function () { if (leer(K_COLA, []).length) enviar(); }, CFG.arranqueMs);   // lo que quedo pendiente de otra vez
})(window);
