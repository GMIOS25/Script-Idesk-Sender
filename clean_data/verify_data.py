import sqlite3

db = sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
cur = db.cursor()

with open('Data_Samples.sql', 'r', encoding='utf-8') as f:
    cur.executescript(f.read())

with open('insert_vinhthanh.sql', 'r', encoding='utf-8') as f:
    cur.executescript(f.read())

print(f"ward: {cur.execute('SELECT COUNT(*) FROM ward').fetchone()[0]}")
print(f"organizational: {cur.execute('SELECT COUNT(*) FROM organizational').fetchone()[0]}")
print(f"person: {cur.execute('SELECT COUNT(*) FROM person').fetchone()[0]}")

print("\n--- WARD ---")
for r in cur.execute('SELECT * FROM ward').fetchall():
    print(r)

print("\n--- ORGANIZATIONAL (first 5) ---")
for r in cur.execute('SELECT * FROM organizational LIMIT 5').fetchall():
    print(r)

print("\n--- PERSON (first 5) ---")
for r in cur.execute('SELECT * FROM person LIMIT 5').fetchall():
    print(r)

# Verify FK integrity
print("\n--- FK CHECK: orphan orgs (parent not in ward) ---")
orphan_orgs = cur.execute('''
    SELECT o.id, o.name, o.parent_id 
    FROM organizational o 
    LEFT JOIN ward w ON o.parent_id = w.id 
    WHERE w.id IS NULL
''').fetchall()
print(f"Found {len(orphan_orgs)} orphan organizational records")

print("\n--- FK CHECK: orphan persons (parent not in organizational) ---")
orphan_persons = cur.execute('''
    SELECT p.id, p.name, p.parent_id 
    FROM person p 
    LEFT JOIN organizational o ON p.parent_id = o.id 
    WHERE o.id IS NULL
''').fetchall()
print(f"Found {len(orphan_persons)} orphan person records")
for r in orphan_persons:
    print(f"  person id={r[0]}, name={r[1]}, parent_id={r[2]}")
