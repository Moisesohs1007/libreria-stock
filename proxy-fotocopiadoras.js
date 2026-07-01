const express = require('express');
const snmp = require('net-snmp');
const cors = require('cors');

const app = express();
const PORT = 3001;

app.use(cors());

console.log('========================================');
console.log('  Proxy SNMP para Fotocopiadoras');
console.log('========================================');
console.log('');
console.log('Escuchando en puerto ' + PORT);
console.log('');

app.get('/snmp', async (req, res) => {
  try {
    const { ip, community, oid } = req.query;
    
    if (!ip || !community || !oid) {
      return res.status(400).json({ error: 'Faltan parámetros: ip, community, oid' });
    }

    console.log(`[${new Date().toLocaleTimeString()}] Consultando ${ip} - OID: ${oid}`);

    const options = {
      version: snmp.Version2c,
      timeout: 5000,
      retries: 1
    };

    const session = snmp.createSession(ip, community, options);

    session.get([oid], (err, varbinds) => {
      if (err) {
        console.error(`[ERROR] ${err.message}`);
        return res.status(500).json({ error: err.message });
      }

      if (varbinds.length > 0) {
        const value = varbinds[0].value;
        console.log(`[OK] Valor: ${value}`);
        res.json({ value: value.toString() });
      } else {
        console.log('[OK] No hay datos');
        res.json({ value: '0' });
      }

      session.close();
    });

  } catch (error) {
    console.error('[ERROR]', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy SNMP listo! Abre la app para empezar.`);
});
