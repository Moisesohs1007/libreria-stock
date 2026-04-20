/**
 * PROXY-RICOH.JS
 * Este servidor actúa como puente entre el navegador (que no puede usar SNMP) 
 * y la fotocopiadora Ricoh MP5055.
 * 
 * Requisitos:
 * 1. Node.js instalado.
 * 2. Instalar dependencias: npm install express net-snmp cors
 * 3. Ejecutar: node proxy-ricoh.js
 */

const express = require('express');
const snmp = require('net-snmp');
const cors = require('cors');

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

// OIDs comunes para impresoras Ricoh
const OIDS = {
    total: "1.3.6.1.2.1.43.10.2.1.4.1.1", // Contador total
    bw: "1.3.6.1.4.1.367.3.2.1.2.19.1.0",  // Contador B/N (específico Ricoh)
    model: "1.3.6.1.2.1.25.3.2.1.3.1"     // Nombre del modelo
};

app.get('/status', (req, res) => {
    const { ip, community } = req.query;

    if (!ip) {
        return res.status(400).json({ error: "Falta la IP de la fotocopiadora" });
    }

    const session = snmp.createSession(ip, community || "public");
    const oids_to_get = [OIDS.total, OIDS.bw, OIDS.model];

    session.get(oids_to_get, (error, varbinds) => {
        if (error) {
            console.error("SNMP Error:", error);
            res.status(500).json({ error: error.message });
        } else {
            const result = {
                total: varbinds[0].value,
                bw: varbinds[1].value,
                model: varbinds[2].value.toString()
            };
            res.json(result);
        }
        session.close();
    });
});

app.get('/snmp', (req, res) => {
    const { ip, community, oid } = req.query;

    if (!ip) {
        return res.status(400).json({ error: "Falta la IP de la fotocopiadora" });
    }
    if (!oid) {
        return res.status(400).json({ error: "Falta el OID" });
    }

    const session = snmp.createSession(ip, community || "public");
    session.get([oid], (error, varbinds) => {
        if (error) {
            console.error("SNMP Error:", error);
            res.status(500).json({ error: error.message });
        } else if (!varbinds || !varbinds.length) {
            res.status(500).json({ error: "Respuesta SNMP vacía" });
        } else {
            res.json({ value: varbinds[0].value.toString() });
        }
        session.close();
    });
});

app.listen(port, () => {
    console.log(`Proxy Ricoh escuchando en http://localhost:${port}`);
    console.log(`Asegúrate de configurar esta IP y puerto en la web.`);
});
