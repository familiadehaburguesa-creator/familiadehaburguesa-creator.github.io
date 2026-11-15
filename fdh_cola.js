/* FDH_COLA · escritura confiable hacia el Cuaderno (E1).
   Cada operacion (venta, gasto, deuda, produccion, tesoreria, fondos) se guarda PRIMERO en el dispositivo con un ID unico
   y se manda al servidor en segundo plano. Solo se da por escrita cuando el servidor CONFIRMA (acuse legible).
   Sin internet o sin respuesta: queda pendiente, a la vista, y se reenvia sola con el MISMO ID (el servidor nunca duplica).
   Si el servidor la rechaza por incompleta, queda aparte y en rojo: nunca se pierde en silencio.
   API: FDH_COLA.url = '<endpoint>';
        FDH_COLA.escribir(hoja, fila, {alConfirmar(resp), alRechazar(motivo)}) -> id
        FDH_COLA.accion({accion:'estadoPedido', ...}, {alConfirmar, alRechazar}) -> id   (misma cola, mismo reintento)
        FDH_COLA.estado() -> {pendientes, rechazadas, enviando, ultimoOk};  FDH_COLA.onCambio(fn);  FDH_COLA.reintentarYa()
        FDH_COLA.pendientesSalvo(id) -> cuantas hay sin confirmar sin contar la indicada (para frenar un cierre)
   Pruebas: window.FDH_COLA_CFG = {timeoutMs, esperas, arranqueMs, sinIndicador}. */
(function (w) {
  var K_COLA = 'fdh_cola_v1', K_RECH = 'fdh_cola_rech_v1', K_DISP = 'fdh_cola_disp_v1';
  var CFG = { timeoutMs: 25000, esperas: [3000, 10000, 30000, 60000, 120000, 300000], arranqueMs: 1500, maxRech: 50, sinIndicador: false };
  var g = w.FDH_COLA_CFG || {}, k;
  for (k in g) CFG[k] = g[k];
  var mem = {}, oyentes = [], enviando = false, intentos = 0, timer = null, ultimoOk = 0, devs = {};

  function leer(clave, def) {
    try { var s = w.localStorage.getItem(clave); if (s) return JSON.parse(s); } catch (e) {}
    return mem[clave] !== undefined ? JSON.parse(JSON.stringify(mem[clave])) : def;
  }
  function guardar(clave, v) {
    mem[clave] = JSON.parse(JSON.stringify(v));
    try { w.localStorage.setItem(clave, JSON.stringify(v)); } catch (e) {}
  }
  function rnd(n) { var s = ''; while (s.length < n) s += Math.random().toString(36).slice(2); return s.slice(0, n); }
  function dispositivo() { var d = leer(K_DISP, null); if (!d || typeof d !== 'string') { d = rnd(4); guardar(K_DISP, d); } return d; }
  function nuevoId() { return 'c' + Date.now().toString(36) + rnd(6) + dispositivo(); }

  function estado() { return { pendientes: leer(K_COLA, []).length, rechazadas: leer(K_RECH, []).length, enviando: enviando, ultimoOk: ultimoOk }; }
  function avisar() { var e = estado(); oyentes.forEach(function (f) { try { f(e); } catch (x) {} }); pintar(e); }
  function programar(ms) { clearTimeout(timer); timer = setTimeout(enviar, ms); }
  function sacar(id) { guardar(K_COLA, leer(K_COLA, []).filter(function (x) { return x.id !== id; })); }
  function rechazar(m, error) {
    var r = leer(K_RECH, []); r.push({ id: m.id, hoja: m.hoja || (m.cuerpo && m.cuerpo.accion) || '', fila: m.fila || m.cuerpo, error: String(error || ''), t: Date.now() });
    guardar(K_RECH, r.slice(-CFG.maxRech)); sacar(m.id);
    var d = devs[m.id]; if (d && d.alRechazar) { try { d.alRechazar(String(error || '')); } catch (x) {} }
  }
  function fallo() { intentos++; avisar(); programar(CFG.esperas[Math.min(intentos - 1, CFG.esperas.length - 1)]); }

  function enviar() {
    if (enviando || !FDH_COLA.url) return;
    var cola = leer(K_COLA, []);
    if (!cola.length) { avisar(); return; }
    var m = cola[0]; enviando = true; avisar();
    var ac = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var tm = setTimeout(function () { if (ac) { try { ac.abort(); } catch (e) {} } }, CFG.timeoutMs);
    var cuerpo = m.cuerpo ? m.cuerpo : { hoja: m.hoja, fila: m.fila, id: m.id };       // accion (ej. marcar un pedido) o fila a una hoja
    var opt = { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(cuerpo) };
    if (ac) opt.signal = ac.signal;
    fetch(FDH_COLA.url, opt)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (tx) { try { return JSON.parse(tx); } catch (e) { throw new Error('respuesta ilegible'); } })
      .then(function (j) {
        clearTimeout(tm); enviando = false;
        if (j && j.ok) {                                   // escrita (o "repetido": ya estaba)
          sacar(m.id); intentos = 0; ultimoOk = Date.now();
          var d = devs[m.id]; delete devs[m.id];
          if (d && d.alConfirmar) { try { d.alConfirmar(j); } catch (x) {} }
          avisar(); programar(0);
        } else if (j && j.codigo === 'invalido') {         // incompleta: no se reintenta, queda a la vista
          rechazar(m, j.error); intentos = 0; avisar(); programar(0);
        } else { fallo(); }                                 // candado ocupado, hoja sin crear, etc.: se reintenta
      })
      .catch(function () { clearTimeout(tm); enviando = false; fallo(); });
  }

  /* ---- indicador en pantalla: aparece solo si hay algo sin confirmar o rechazado ---- */
  var pill = null;
  function pintar(e) {
    if (CFG.sinIndicador || typeof document === 'undefined' || !document.body) return;
    if (!pill) {
      pill = document.createElement('div'); pill.id = 'fdhColaEstado';
      pill.setAttribute('role', 'status'); pill.setAttribute('aria-live', 'polite');
      pill.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9998;max-width:calc(100vw - 16px);padding:6px 10px;border-radius:14px;font:600 12px/1.3 system-ui,sans-serif;background:#2b2417;color:#f2c14e;border:1px solid #f2c14e;box-shadow:0 2px 8px rgba(0,0,0,.4);display:none;cursor:pointer';
      pill.addEventListener('click', function () {
        var rs = leer(K_RECH, []);
        if (rs.length) {                                     // aviso rojo: se da por visto despues de leerlo (queda en el registro del servidor)
          var txt = rs.slice(0, 3).map(function (x) { return '• ' + (x.hoja || 'operación') + ': ' + x.error; }).join('\n');
          if (w.confirm('No se pudo guardar:\n' + txt + '\n\nAvisá a un socio. ¿Ya lo viste y querés sacar este aviso?')) { guardar(K_RECH, []); avisar(); }
        } else FDH_COLA.reintentarYa();
      });
      document.body.appendChild(pill);
    }
    if (e.rechazadas) {
      pill.style.display = 'block'; pill.style.background = '#3a1613'; pill.style.color = '#ff8a80'; pill.style.borderColor = '#ff8a80';
      pill.textContent = '⚠ ' + e.rechazadas + (e.rechazadas === 1 ? ' operación NO se pudo guardar' : ' operaciones NO se pudieron guardar') + ' · avisá a un socio';
    } else if (e.pendientes) {
      pill.style.display = 'block'; pill.style.background = '#2b2417'; pill.style.color = '#f2c14e'; pill.style.borderColor = '#f2c14e';
      pill.textContent = '⏳ ' + e.pendientes + (e.pendientes === 1 ? ' operación sin confirmar' : ' operaciones sin confirmar') + (e.enviando ? ' · enviando…' : ' · toque para reintentar');
    } else { pill.style.display = 'none'; }
  }

  var FDH_COLA = {
    url: '',
    nuevoId: nuevoId,
    escribir: function (hoja, fila, op) {
      var m = { id: nuevoId(), hoja: hoja, fila: fila, t: Date.now() };
      devs[m.id] = op || {};
      var cola = leer(K_COLA, []); cola.push(m); guardar(K_COLA, cola);   // primero se guarda en el dispositivo
      avisar(); programar(0);
      return m.id;
    },
    /** Accion al servidor (ej. {accion:'estadoPedido', ...}) por la misma cola: se reintenta hasta que el servidor confirma. Devuelve el ID. */
    accion: function (cuerpo, op) {
      var m = { id: nuevoId(), cuerpo: cuerpo, t: Date.now() };
      devs[m.id] = op || {};
      var cola = leer(K_COLA, []); cola.push(m); guardar(K_COLA, cola);
      avisar(); programar(0);
      return m.id;
    },
    estado: estado,
    pendientesSalvo: function (id) { return leer(K_COLA, []).filter(function (x) { return x.id !== id; }).length; },
    onCambio: function (f) { oyentes.push(f); },
    reintentarYa: function () { intentos = 0; programar(0); },
    rechazadas: function () { return leer(K_RECH, []); }
  };
  w.FDH_COLA = FDH_COLA;

  try { w.addEventListener('online', function () { intentos = 0; programar(0); }); } catch (e) {}
  try { document.addEventListener('visibilitychange', function () { if (!document.hidden && leer(K_COLA, []).length) { intentos = 0; programar(0); } }); } catch (e) {}
  setTimeout(function () { avisar(); if (leer(K_COLA, []).length) enviar(); }, CFG.arranqueMs);   // lo que quedo pendiente de otra vez
})(window);
