/* FDH_RED · capa de red compartida (Fase 1, P-3) ----------------------------------------
   Pide datos al MENSAJERO con fetch (sin callback: el servidor devuelve JSON puro; leido desde
   github.io responde con CORS y se puede cancelar, cosa que el JSONP no permite).

   FDH_RED.pedir(url, opciones) -> Promise con el JSON de la respuesta.

   - Un intento que tarda mas de `intentoMs` NO se cancela: se lanza el siguiente y los dos corren
     juntos. Gana el primero que responde (una respuesta lenta, de 4 a 12 s o mas, sigue sirviendo,
     como pasaba con el JSONP) y recien entonces se cancelan los demas.
   - Un fallo rapido (sin red, HTTP distinto de 200, respuesta que no es JSON) lanza el siguiente
     intento despues de `reintentoMs`.
   - Hasta `maxIntentos` intentos y un tope de `totalMs` en total; si nada responde, la promesa
     se rechaza y el modulo muestra lo que tenga guardado.
   - `onEstado({intento, de, ms})` avisa cada vez que se lanza un intento nuevo (el 2 y el 3)
     para que la pantalla diga "reintentando".
   - Una respuesta con {ok:false} NO se reintenta: es la respuesta del servidor y la decide el modulo.
   - Las escrituras (POST) NO pasan por aca: siguen como estan.
   Configuracion global opcional (pruebas): window.FDH_RED_CFG = {intentoMs, totalMs, reintentoMs, maxIntentos}. */
(function (w) {
  var CFG = { intentoMs: 12000, totalMs: 45000, reintentoMs: 800, maxIntentos: 3 };

  function pedir(url, op) {
    var cfg = {}, k, g = w.FDH_RED_CFG || {};
    for (k in CFG) cfg[k] = CFG[k];
    for (k in g) cfg[k] = g[k];
    for (k in (op || {})) cfg[k] = op[k];

    return new Promise(function (resolve, reject) {
      var t0 = Date.now(), lanzados = 0, fallados = 0, fin = false, ultimoError = null;
      var controles = [], timerSig = null, timerTotal = null;

      function limpiar() {
        clearTimeout(timerSig); clearTimeout(timerTotal);
        controles.forEach(function (c) { try { c.abort(); } catch (e) {} });
      }
      function terminar(ok, valor) {
        if (fin) return; fin = true; limpiar();
        if (ok) resolve(valor); else reject(valor);
      }
      function programar(ms) {                      // un solo "siguiente intento" a la vez
        clearTimeout(timerSig);
        if (!fin && lanzados < cfg.maxIntentos) timerSig = setTimeout(lanzar, ms);
      }
      function lanzar() {
        if (fin || lanzados >= cfg.maxIntentos) return;
        var n = ++lanzados;
        var ac = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        if (ac) controles.push(ac);
        if (n > 1 && cfg.onEstado) { try { cfg.onEstado({ intento: n, de: cfg.maxIntentos, ms: Date.now() - t0 }); } catch (e) {} }
        fetch(url, ac ? { signal: ac.signal, cache: 'no-store' } : { cache: 'no-store' })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
          .then(function (tx) {
            var j; try { j = JSON.parse(tx); } catch (e) { throw new Error('la respuesta no es JSON'); }
            terminar(true, j);
          })
          .catch(function (e) {
            if (fin || (e && e.name === 'AbortError')) return;
            ultimoError = e; fallados++;
            if (fallados >= cfg.maxIntentos) return terminar(false, ultimoError || new Error('sin respuesta'));
            programar(cfg.reintentoMs);              // fallo rapido: reintentar enseguida
          });
        programar(cfg.intentoMs);                     // si este no responde a tiempo, lanzar otro sin cancelarlo
      }
      timerTotal = setTimeout(function () { terminar(false, ultimoError || new Error('tiempo agotado')); }, cfg.totalMs);
      lanzar();
    });
  }
  w.FDH_RED = { pedir: pedir, config: CFG };
})(window);
