const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'cloud_data.json');

// Inicjalizacja domyślnych danych
function loadData() {
  const defaultData = {
    workers: ['Dominika', 'Jan', 'Marek', 'Anna'],
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
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
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
  // Nagłówki CORS, aby frontend na GitHub Pages mógł swobodnie komunikować się z API na Renderze
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // Serwowanie aplikacji frontendowej (jeśli ktoś wejdzie bezpośrednio na link z Rendera)
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

  // --- API PRACOWNICY ---
  if (url.pathname === '/api/workers') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(db.workers || []));
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { name } = JSON.parse(body);
          if (name && typeof name === 'string') {
            const cleanName = name.trim();
            if (!db.workers.includes(cleanName)) {
              db.workers.push(cleanName);
              saveData(db);
            }
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, workers: db.workers }));
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Nieprawidłowe imię pracownika' }));
          }
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Błędny JSON' }));
        }
      });
      return;
    }
  }

  // --- API MAGAZYN (Pobieranie i synchronizacja bazy pozycji) ---
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

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(PORT, () => {
  console.log(`Serwer chmurowy etykiet działa na porcie ${PORT}`);
});
