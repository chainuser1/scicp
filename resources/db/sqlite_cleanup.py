import sqlite3

# 👇 Change this to your actual database path
db_path = "cebuano-scriptures-sqlite.db"

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Preview how many rows will be affected
cursor.execute("SELECT COUNT(*) FROM verses WHERE scripture_text LIKE '%â\x80\x94%'")
count = cursor.fetchone()[0]
print(f"Rows to update: {count}")

# Perform the replacement
cursor.execute("""
    UPDATE verses
    SET scripture_text = REPLACE(scripture_text, 'â\x80\x94', ' — ')
    WHERE scripture_text LIKE '%â\x80\x94%'
""")

conn.commit()
print(f"Done! {cursor.rowcount} rows updated.")
conn.close()