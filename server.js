const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let pg = null;
try {
  pg = require('pg');
} catch (e) {
  console.log('Pakiet pg nie jest jeszcze zainstalowany lokalnie, używam trybu zgodności');
}

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'cloud_data.json');
const DATABASE_URL = process.env.DATABASE_URL;

// Haszowanie haseł
function hashPassword(pass) {
  return crypto.createHash('sha256').update(pass + '_salt_salt').digest('hex');
}

let pool = null;
if (DATABASE_URL && pg) {
  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  // Tworzenie trwałych tabel w PostgreSQL
  pool.query(`
    CREATE TABLE IF NOT EXISTS etykiety_users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS etykiety_warehouse (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      type VARCHAR(50) NOT NULL,
      default_param VARCHAR(100)
    );

    CREATE TABLE IF NOT EXISTS etykiety_orders (
      id SERIAL PRIMARY KEY,
      order_number VARCHAR(100) UNIQUE NOT NULL,
      data JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `).then(() => {
    console.log('Trwałe tabele PostgreSQL (Supabase) gotowe!');
  }).catch(err => {
    console.error('Błąd inicjalizacji PostgreSQL:', err);
  });
}

// Fallback do pliku JSON jeśli brak bazy SQL
function loadLocalData() {
  const defaultData = {
    workers: [],
    orders: [],
    warehouse: [
      { name: 'Pudełko z małymi częściami', type: 'box', defaultParam: '' },
      { name: 'Brama dwuskrzydłowa', type: 'double_gate', defaultParam: '' },
      { name: 'Słupek', type: 'post', defaultParam: '120x120' },
      { name: 'Furtka wejściowa', type: 'standard', defaultParam: '1000x1500' },
      { name: 'Przęsło ogrodzeniowe', type: 'standard', defaultParam: '2000x1200' },
      { name: 'Brama przesuwna', type: 'standard', defaultParam: '4000x1500' }
    ]
  };

  try {
    if (fs.existsSync(DATA_FILE)) {
      const read = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (!Array.isArray(read.orders)) read.orders = [];
      if (!Array.isArray(read.workers)) read.workers = [];
      return read;
    }
  } catch (e) {}
  return defaultData;
}

function saveLocalData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
}

let localDb = loadLocalData();

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // Serwowanie aplikacji
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const indexPath = path.join(__dirname, 'index.html');
    fs.readFile(indexPath, 'utf8', (err, html) => {
      if (err) {
        res.writeHead(500);
        res.end('Błąd index.html');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    return;
  }

  // --- API LOGOWANIE ---
  if (url.pathname === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { username, password } = JSON.parse(body);
        if (!username || !password) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Podaj login i hasło' }));
          return;
        }

        const cleanUser = username.trim();
        const pwdHash = hashPassword(password);

        if (pool) {
          const result = await pool.query('SELECT * FROM etykiety_users WHERE LOWER(username) = LOWER($1)', [cleanUser]);
          if (result.rows.length === 0 || result.rows[0].password_hash !== pwdHash) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Nieprawidłowy login lub hasło' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, username: result.rows[0].username }));
          return;
        }

        // Fallback lokalny
        const found = localDb.workers.find(w => w.username.toLowerCase() === cleanUser.toLowerCase());
        if (!found || found.passwordHash !== pwdHash) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Nieprawidłowy login lub hasło' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, username: found.username }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Błąd logowania' }));
      }
    });
    return;
  }

  // --- API REJESTRACJA ---
  if (url.pathname === '/api/register' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { username, password } = JSON.parse(body);
        const cleanUser = (username || '').trim();

        if (cleanUser.length < 2 || (password || '').length < 3) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Login min. 2 znaki, hasło min. 3 znaki' }));
          return;
        }

        const pwdHash = hashPassword(password);

        if (pool) {
          const check = await pool.query('SELECT id FROM etykiety_users WHERE LOWER(username) = LOWER($1)', [cleanUser]);
          if (check.rows.length > 0) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Pracownik o takim loginie już istnieje!' }));
            return;
          }

          await pool.query('INSERT INTO etykiety_users (username, password_hash) VALUES ($1, $2)', [cleanUser, pwdHash]);
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, username: cleanUser }));
          return;
        }

        // Fallback lokalny
        const exists = localDb.workers.some(w => w.username.toLowerCase() === cleanUser.toLowerCase());
        if (exists) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Pracownik o takim loginie już istnieje!' }));
          return;
        }

        localDb.workers.push({ username: cleanUser, passwordHash: pwdHash });
        saveLocalData(localDb);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, username: cleanUser }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Błąd rejestracji' }));
      }
    });
    return;
  }

  // --- API PRACOWNICY ---
  if (url.pathname === '/api/workers' && req.method === 'GET') {
    if (pool) {
      try {
        const result = await pool.query('SELECT username FROM etykiety_users ORDER BY username ASC');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result.rows.map(r => r.username)));
        return;
      } catch (e) {}
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(localDb.workers.map(w => w.username)));
    return;
  }

  // --- API MAGAZYN ZAMÓWIEŃ ---
  if (url.pathname === '/api/orders') {
    if (req.method === 'GET') {
      if (pool) {
        try {
          const result = await pool.query('SELECT data FROM etykiety_orders ORDER BY updated_at DESC');
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(result.rows.map(r => r.data)));
          return;
        } catch (e) {}
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(localDb.orders || []));
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const order = JSON.parse(body);
          const cleanNum = (order.orderNumber || '').trim();
          if (!cleanNum) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Brak numeru zamówienia' }));
            return;
          }

          if (pool) {
            await pool.query(`
              INSERT INTO etykiety_orders (order_number, data, updated_at)
              VALUES ($1, $2, CURRENT_TIMESTAMP)
              ON CONFLICT (order_number)
              DO UPDATE SET data = EXCLUDED.data, updated_at = CURRENT_TIMESTAMP
            `, [cleanNum, JSON.stringify(order)]);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true }));
            return;
          }

          // Fallback lokalny
          const existingIdx = localDb.orders.findIndex(o => (o.orderNumber || '').trim().toLowerCase() === cleanNum.toLowerCase());
          if (existingIdx >= 0) localDb.orders[existingIdx] = order;
          else localDb.orders.unshift(order);
          saveLocalData(localDb);

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, orders: localDb.orders }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Błąd zapisu zamówienia' }));
        }
      });
      return;
    }
  }

  // --- API MAGAZYN POZYCJI ---
  if (url.pathname === '/api/warehouse') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(localDb.warehouse || []));
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const items = JSON.parse(body);
          if (Array.isArray(items)) {
            localDb.warehouse = items;
            saveLocalData(localDb);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, warehouse: localDb.warehouse }));
          }
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Błędny JSON' }));
        }
      });
      return;
    }
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(PORT, () => {
  console.log(`Serwer działa na porcie ${PORT}`);
});
