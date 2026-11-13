const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let pg = null;
try {
  pg = require('pg');
} catch (e) {
  console.log('Pakiet pg nie zainstalowany');
}

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;

function hashPassword(pass) {
  return crypto.createHash('sha256').update(pass + '_salt_salt').digest('hex');
}

let pool = null;
if (DATABASE_URL && pg) {
  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  pool.query(`
    CREATE TABLE IF NOT EXISTS etykiety_users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      is_admin BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS etykiety_profiles (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      type VARCHAR(100),
      length VARCHAR(50),
      weight NUMERIC(10, 4),
      a NUMERIC(10, 2),
      b NUMERIC(10, 2),
      t NUMERIC(10, 2),
      profile_category VARCHAR(50),
      is_custom BOOLEAN DEFAULT FALSE,
      created_at BIGINT
    );

    CREATE TABLE IF NOT EXISTS etykiety_warehouse (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      type VARCHAR(50) NOT NULL,
      default_param VARCHAR(100),
      created_at BIGINT
    );

    
    CREATE TABLE IF NOT EXISTS etykiety_options (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      jm VARCHAR(50),
      qty VARCHAR(50),
      element VARCHAR(100),
      montaz VARCHAR(100),
      opis TEXT,
      created_at BIGINT
    );

    CREATE TABLE IF NOT EXISTS etykiety_sets (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      element VARCHAR(100),
      model VARCHAR(100),
      items JSONB DEFAULT '[]'::jsonb,
      last_modified_by VARCHAR(100),
      last_modified_at VARCHAR(100),
      created_at BIGINT
    );
    CREATE TABLE IF NOT EXISTS etykiety_orders (
      id SERIAL PRIMARY KEY,
      order_number VARCHAR(100) UNIQUE NOT NULL,
      data JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `).then(() => {
    console.log('Tabele w PostgreSQL gotowe!');
  }).catch(console.error);
}

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

        if (!pool) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Brak połączenia z bazą danych' }));
          return;
        }

        const result = await pool.query('SELECT id, username, password_hash, is_admin FROM etykiety_users WHERE LOWER(username) = LOWER($1)', [cleanUser]);
        if (result.rows.length === 0 || result.rows[0].password_hash !== pwdHash) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Nieprawidłowy login lub hasło' }));
          return;
        }

        const user = result.rows[0];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          username: user.username,
          isAdmin: !!user.is_admin
        }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Błąd przetwarzania logowania' }));
      }
    });
    return;
  }

  // --- API REJESTRACJA (dla nowych pracowników) ---
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

        const check = await pool.query('SELECT id FROM etykiety_users WHERE LOWER(username) = LOWER($1)', [cleanUser]);
        if (check.rows.length > 0) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Pracownik o takim loginie już istnieje!' }));
          return;
        }

        await pool.query(
          'INSERT INTO etykiety_users (username, password_hash, is_admin) VALUES ($1, $2, $3)',
          [cleanUser, pwdHash, false]
        );

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, username: cleanUser, isAdmin: false }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Błąd rejestracji' }));
      }
    });
    return;
  }

  // --- API ADMIN: POBIERANIE WSZYSTKICH PRACOWNIKÓW ---
  if (url.pathname === '/api/admin/users' && req.method === 'GET') {
    try {
      const result = await pool.query('SELECT id, username, is_admin, to_char(created_at, \'YYYY-MM-DD HH24:MI\') as created_at FROM etykiety_users ORDER BY id ASC');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result.rows));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Błąd pobierania użytkowników' }));
    }
    return;
  }

  // --- API ADMIN: EDYCJA PRACOWNIKA (zmiana loginu lub reset hasła) ---
  if (url.pathname === '/api/admin/users/update' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { id, username, newPassword } = JSON.parse(body);
        if (!id || !username) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Brak id lub loginu' }));
          return;
        }

        const cleanUser = username.trim();

        if (newPassword && newPassword.trim().length >= 3) {
          const hash = hashPassword(newPassword.trim());
          await pool.query('UPDATE etykiety_users SET username = $1, password_hash = $2 WHERE id = $3', [cleanUser, hash, id]);
        } else {
          await pool.query('UPDATE etykiety_users SET username = $1 WHERE id = $2', [cleanUser, id]);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Błąd aktualizacji pracownika (może login jest już zajęty)' }));
      }
    });
    return;
  }

  // --- API ADMIN: USUNIĘCIE PRACOWNIKA ---
  if (url.pathname === '/api/admin/users/delete' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { id } = JSON.parse(body);
        if (!id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Brak ID' }));
          return;
        }

        // Zabezpieczenie przed usunięciem konta głównego Dominika
        const check = await pool.query('SELECT username FROM etykiety_users WHERE id = $1', [id]);
        if (check.rows.length > 0 && check.rows[0].username.toLowerCase() === 'dominika') {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Nie można usunąć głównego konta administratora!' }));
          return;
        }

        await pool.query('DELETE FROM etykiety_users WHERE id = $1', [id]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Błąd usuwania użytkownika' }));
      }
    });
    return;
  }

  // --- API LISTA LOGINÓW (PUBLICZNA DLA WYBORU PRACOWNIKA) ---
  if (url.pathname === '/api/workers' && req.method === 'GET') {
    try {
      const result = await pool.query('SELECT username FROM etykiety_users ORDER BY username ASC');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result.rows.map(r => r.username)));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([]));
    }
    return;
  }

  // --- API MAGAZYN ZAMÓWIEŃ (WSPÓŁDZIELONY DLA WSZYSTKICH) ---
  if (url.pathname === '/api/orders') {
    if (req.method === 'GET') {
      try {
        if (!pool) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify([]));
          return;
        }
        const result = await pool.query('SELECT data FROM etykiety_orders ORDER BY updated_at DESC');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result.rows.map(r => r.data)));
      } catch (e) {
        console.error('Błąd pobierania zamówień:', e);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
      }
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
          }

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          console.error('Błąd zapisu zamówienia:', e);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Błąd zapisu zamówienia w bazie' }));
        }
      });
      return;
    }

    if (req.method === 'DELETE') {
      const orderNum = url.searchParams.get('orderNumber');
      if (!orderNum) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Brak numeru zamówienia' }));
        return;
      }
      try {
        if (pool) {
          await pool.query('DELETE FROM etykiety_orders WHERE LOWER(order_number) = LOWER($1)', [orderNum.trim()]);
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        console.error('Błąd usuwania zamówienia:', e);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Błąd usuwania zamówienia' }));
      }
      return;
    }
  }


  // --- API MAGAZYN OPCJI ---
  if (url.pathname === '/api/options') {
    if (req.method === 'GET') {
      try {
        if (!pool) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify([]));
          return;
        }
        const result = await pool.query('SELECT id, name, jm, qty, element, montaz, opis, created_at as "createdAt" FROM etykiety_options ORDER BY id ASC');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result.rows));
      } catch (err) {
        console.error('Błąd pobierania opcji:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
      }
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const items = JSON.parse(body);
          if (!Array.isArray(items)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Dane muszą być tablicą' }));
            return;
          }

          if (pool) {
            const client = await pool.connect();
            try {
              await client.query('BEGIN');
              await client.query('DELETE FROM etykiety_options');
              for (const item of items) {
                if (!item.name) continue;
                await client.query(
                  'INSERT INTO etykiety_options (name, jm, qty, element, montaz, opis, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                  [item.name.trim(), item.jm || '', item.qty !== undefined ? String(item.qty) : '', item.element || '', item.montaz || '', item.opis || '', item.createdAt || Date.now()]
                );
              }
              await client.query('COMMIT');
            } catch (txErr) {
              await client.query('ROLLBACK');
              throw txErr;
            } finally {
              client.release();
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, count: items.length }));
        } catch (e) {
          console.error('Błąd zapisu opcji:', e);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Błąd zapisu opcji w chmurze' }));
        }
      });
      return;
    }
  }

  // --- API MAGAZYN ZBIORÓW ---
  if (url.pathname === '/api/sets') {
    if (req.method === 'GET') {
      try {
        if (!pool) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify([]));
          return;
        }
        const result = await pool.query('SELECT id, title, element, model, items, last_modified_by as "lastModifiedBy", last_modified_at as "lastModifiedAt", created_at as "createdAt" FROM etykiety_sets ORDER BY id ASC');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result.rows));
      } catch (err) {
        console.error('Błąd pobierania zbiorów:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
      }
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const sets = JSON.parse(body);
          if (!Array.isArray(sets)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Dane muszą być tablicą' }));
            return;
          }

          if (pool) {
            const client = await pool.connect();
            try {
              await client.query('BEGIN');
              await client.query('DELETE FROM etykiety_sets');
              for (const s of sets) {
                if (!s.title && !s.element) continue;
                await client.query(
                  'INSERT INTO etykiety_sets (title, element, model, items, last_modified_by, last_modified_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                  [
                    (s.title || (s.element + ' - ' + (s.model || ''))).trim(),
                    (s.element || '').trim(),
                    (s.model || '').trim(),
                    JSON.stringify(s.items || []),
                    s.lastModifiedBy || '',
                    s.lastModifiedAt || new Date().toLocaleString('pl-PL'),
                    s.createdAt || Date.now()
                  ]
                );
              }
              await client.query('COMMIT');
            } catch (txErr) {
              await client.query('ROLLBACK');
              throw txErr;
            } finally {
              client.release();
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, count: sets.length }));
        } catch (e) {
          console.error('Błąd zapisu zbiorów:', e);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Błąd zapisu zbiorów w chmurze' }));
        }
      });
      return;
    }
  }

  // --- API MAGAZYN PROFILI (WSPÓŁDZIELONY DLA WSZYSTKICH) ---
  if (url.pathname === '/api/profiles') {
    if (req.method === 'GET') {
      try {
        if (!pool) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify([]));
          return;
        }
        const result = await pool.query('SELECT name, type, length, weight, a, b, t, profile_category as "profileCategory", is_custom as "isCustom", created_at as "createdAt" FROM etykiety_profiles ORDER BY id ASC');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result.rows));
      } catch (err) {
        console.error('Błąd pobierania bazy profili:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
      }
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const profiles = JSON.parse(body);
          if (!Array.isArray(profiles)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Dane muszą być tablicą profili' }));
            return;
          }

          if (pool) {
            const client = await pool.connect();
            try {
              await client.query('BEGIN');
              await client.query('DELETE FROM etykiety_profiles');
              for (const p of profiles) {
                if (!p.name) continue;
                await client.query(
                  'INSERT INTO etykiety_profiles (name, type, length, weight, a, b, t, profile_category, is_custom, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
                  [
                    p.name.trim(),
                    p.type || 'Profil kwadrat/prost.',
                    (p.length || '6000').toString(),
                    (p.weight !== undefined && p.weight !== null && p.weight !== '') ? parseFloat(p.weight) : null,
                    p.a ? parseFloat(p.a) : null,
                    p.b ? parseFloat(p.b) : null,
                    p.t ? parseFloat(p.t) : null,
                    p.profileCategory || '',
                    !!p.isCustom,
                    p.createdAt || Date.now()
                  ]
                );
              }
              await client.query('COMMIT');
            } catch (txErr) {
              await client.query('ROLLBACK');
              throw txErr;
            } finally {
              client.release();
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, count: profiles.length }));
        } catch (e) {
          console.error('Błąd zapisu profili w chmurze:', e);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Błąd zapisu bazy profili w chmurze' }));
        }
      });
      return;
    }
  }

  // --- API MAGAZYN POZYCJI (WSPÓŁDZIELONY DLA WSZYSTKICH) ---
  if (url.pathname === '/api/warehouse') {
    if (req.method === 'GET') {
      try {
        if (!pool) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify([]));
          return;
        }
        const result = await pool.query('SELECT name, type, default_param as "defaultParam", created_at as "createdAt" FROM etykiety_warehouse ORDER BY id ASC');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result.rows));
      } catch (err) {
        console.error('Błąd pobierania magazynu:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
      }
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const items = JSON.parse(body);
          if (!Array.isArray(items)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Dane muszą być tablicą' }));
            return;
          }

          if (pool) {
            const client = await pool.connect();
            try {
              await client.query('BEGIN');
              await client.query('DELETE FROM etykiety_warehouse');
              for (const item of items) {
                if (!item.name) continue;
                await client.query(
                  'INSERT INTO etykiety_warehouse (name, type, default_param, created_at) VALUES ($1, $2, $3, $4)',
                  [item.name.trim(), item.type || 'standard', item.defaultParam || '', item.createdAt || Date.now()]
                );
              }
              await client.query('COMMIT');
            } catch (txErr) {
              await client.query('ROLLBACK');
              throw txErr;
            } finally {
              client.release();
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, count: items.length }));
        } catch (e) {
          console.error('Błąd zapisu magazynu:', e);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Błąd zapisu magazynu w chmurze' }));
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
