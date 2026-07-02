const express = require('express');
const snmp = require('net-snmp');
const cors = require('cors');

const app = express();
const PORT = 3001;

app.use(cors());

function normalizeSnmpValue(value) {
  if (Buffer.isBuffer(value)) return value.toString("utf8").trim();
  if (Array.isArray(value)) return value.map(normalizeSnmpValue).join(", ");
  if (value && typeof value === "object" && typeof value.toString === "function") {
    return value.toString().trim();
  }
  return String(value ?? "").trim();
}

function createSnmpSession(ip, community) {
  const options = {
    version: snmp.Version2c,
    timeout: 5000,
    retries: 1
  };
  return snmp.createSession(ip, community, options);
}

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

    const session = createSnmpSession(ip, community);

    session.get([oid], (err, varbinds) => {
      if (err) {
        console.error(`[ERROR] ${err.message}`);
        session.close();
        return res.status(500).json({ error: err.message });
      }

      if (varbinds.length > 0) {
        const value = normalizeSnmpValue(varbinds[0].value);
        console.log(`[OK] Valor: ${value}`);
        res.json({ value });
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

app.get('/snmp-walk', async (req, res) => {
  try {
    const { ip, community, oid } = req.query;

    if (!ip || !community || !oid) {
      return res.status(400).json({ error: 'Faltan parámetros: ip, community, oid' });
    }

    console.log(`[${new Date().toLocaleTimeString()}] Recorriendo ${ip} - OID base: ${oid}`);

    const session = createSnmpSession(ip, community);
    const values = [];

    session.subtree(
      oid,
      20,
      (varbinds) => {
        for (const vb of varbinds || []) {
          if (snmp.isVarbindError(vb)) {
            values.push({
              oid: vb.oid,
              error: snmp.varbindError(vb)
            });
            continue;
          }
          values.push({
            oid: vb.oid,
            value: normalizeSnmpValue(vb.value)
          });
        }
      },
      (err) => {
        session.close();
        if (err) {
          console.error(`[ERROR] ${err.message}`);
          return res.status(500).json({ error: err.message });
        }
        res.json({ values });
      }
    );
  } catch (error) {
    console.error('[ERROR]', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy SNMP listo! Abre la app para empezar.`);
});
