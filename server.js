const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'cloud_data.json');

// Funkcja haszująca hasło
function hashPassword(pass) {
  return crypto.createHash('sha256').update(pass + '_salt_salt').digest('hex');
}

// Inicjalizacja danych
function loadData() {
  const defaultData = {
    workers: [],
    orders: [], // Magazyn zapisanych zamówień
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
  } catch (e) {
    console.error('Błąd odczytu cloud_data.json:', e);
  }
  return defaultData;
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Błąd zapisu cloud_data.json:', e);
  }
}

let db = loadData();

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // Serwowanie aplikacji frontendowej
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const indexPath = path.join(__dirname, 'index.html');
    fs.readFile(indexPath, 'utf8', (err, html) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Błąd odczytu pliku index.html');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    return;
  }

  // --- API LOGOWANIE PRACOWNIKA ---
  if (url.pathname === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { username, password } = JSON.parse(body);
        if (!username || !password) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Podaj login i hasło' }));
          return;
        }

        const cleanUser = username.trim();
        const pwdHash = hashPassword(password);

        const found = db.workers.find(w => w.username.toLowerCase() === cleanUser.toLowerCase());
        if (!found || found.passwordHash !== pwdHash) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Nieprawidłowy login lub hasło' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, username: found.username }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Błąd przetwarzania danych' }));
      }
    });
    return;
  }

  // --- API REJESTRACJA PRACOWNIKA ---
  if (url.pathname === '/api/register' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { username, password } = JSON.parse(body);
        if (!username || !password) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Wypełnij login i hasło' }));
          return;
        }

        const cleanUser = username.trim();
        if (cleanUser.length < 2) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Login musi mieć min. 2 znaki' }));
          return;
        }

        if (password.length < 3) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Hasło musi mieć min. 3 znaki' }));
          return;
        }

        const exists = db.workers.some(w => w.username.toLowerCase() === cleanUser.toLowerCase());
        if (exists) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Pracownik o takim loginie już istnieje!' }));
          return;
        }

        const newWorker = {
          username: cleanUser,
          passwordHash: hashPassword(password),
          createdAt: new Date().toISOString()
        };

        db.workers.push(newWorker);
        saveData(db);

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, username: cleanUser }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Błąd przetwarzania danych' }));
      }
    });
    return;
  }

  // --- API POBIERANIE LISTY PRACOWNIKÓW ---
  if (url.pathname === '/api/workers' && req.method === 'GET') {
    const list = db.workers.map(w => w.username);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(list));
    return;
  }

  // --- API MAGAZYN POZYCJI ---
  if (url.pathname === '/api/warehouse') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(db.warehouse || []));
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const newItems = JSON.parse(body);
          if (Array.isArray(newItems)) {
            db.warehouse = newItems;
            saveData(db);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, warehouse: db.warehouse }));
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Oczekiwano tablicy pozycji' }));
          }
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Błędny JSON' }));
        }
      });
      return;
    }
  }

  // --- API MAGAZYN ZAMÓWIEŃ (Zapis / Nadpisywanie po orderNumber) ---
  if (url.pathname === '/api/orders') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(db.orders || []));
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const order = JSON.parse(body);
          if (!order.orderNumber) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Brak numeru zamówienia' }));
            return;
          }

          if (!Array.isArray(db.orders)) db.orders = [];

          // Szukamy czy zamówienie o tym numerze już istnieje (nadpisywanie)
          const cleanNum = order.orderNumber.trim();
          const existingIdx = db.orders.findIndex(o => (o.orderNumber || '').trim().toLowerCase() === cleanNum.toLowerCase());

          order.updatedAt = new Date().toISOString();

          if (existingIdx >= 0) {
            db.orders[existingIdx] = order;
          } else {
            order.createdAt = new Date().toISOString();
            db.orders.unshift(order);
          }

          saveData(db);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, orders: db.orders }));
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
  console.log(`Serwer etykiet działa na porcie ${PORT}`);
});
