# Scripture Projection Engine - Quick Start Guide

## Overview
This is a real-time scripture projection system for controlling what displays on screens during presentations. The presenter uses a desktop interface to search, stage, and broadcast scripture verses to one or more client displays.

## Setup & Running

### Prerequisites
- Node.js 16+ installed
- SQLite database at `resources/db/lds-scriptures-sqlite.db`

### Starting the Application

```bash
# From project root
npm run dev

# This starts both backend (port 3000) and frontend (port 5173)
# Frontend available at: http://localhost:5173
```

### Architecture
- **Backend:** Fastify + Socket.IO + SQLite (port 3000)
- **Frontend:** React + Vite + Socket.IO (port 5173)
- **Database:** LDS scriptures SQLite database with 100,000+ verses

## Using the Presenter Interface

### 1. Search for Scripture

#### Method A: Abbreviated Book References (NEW!)
Type abbreviated scripture references just like you'd write them:
- `1 Ne 1:1` → Searches for "1 Nephi 1:1"
- `D&C 1:12` → Searches for "Doctrine and Covenants 1:12"
- `Matt 3:16` → Searches for "Matthew 3:16"
- `2 Ne 2:25` → Searches for "2 Nephi 2:25"

#### Method B: Full Book Names
Type the complete book name:
- `1 Nephi 1:1`
- `Doctrine and Covenants 1:12`
- `Matthew 3:16`

#### Method C: Phrase Search (ENHANCED!)
Search for words or phrases to find all matching verses:
- `love` → Returns up to 50 verses containing "love"
- `faith and works` → Returns verses with the exact phrase
- `endure` → Searches both scripture text and verse titles

### 2. Search Results Panel (Left)
The search results list shows:
- **Verse Title:** e.g., "1 Nephi 1:1"
- **Scripture Text:** Preview of the verse content
- **Up to 50 Results:** More options to choose from

**Interaction:** Click any result to stage it.

### 3. Staging Area (Center)
Once you've selected a verse:
- The verse appears in the "Now Staging" section
- Shows full verse title and text
- **Previous/Next buttons** let you navigate chapter verses
- **Go Live button (🔴)** broadcasts the verse to all clients

### 4. Navigation Controls

#### "Now Playing" Section
When a verse is currently live (broadcasting):
- Shows the currently displayed verse
- **Previous/Next buttons** navigate to adjacent verses
- Navigation happens immediately (goes live automatically)

#### Staging Navigation
When you have a verse staged but not live:
- **Previous/Next buttons** navigate while staging
- Allows you to preview verses before broadcasting

### 5. Theme & Display Management

#### Built-in Themes
- **Light:** Serif font, light background, large text
- **Dark:** Sans-serif font, dark background, very large text

#### Custom Themes
1. Click theme buttons to apply
2. Optional: Enter custom background image URL
   - Click "Apply" to set the background
3. Save your current theme:
   - Enter a name (e.g., "Easter 2025")
   - Click "Save"
   - Theme appears as a button for future use

### 6. History Panel (Right)
Shows the last 5 verses you've broadcast:
- Click any history verse to re-stage it
- Useful for going back to frequently-used passages

## Common Workflows

### Workflow 1: Quick Reference Navigation
```
1. Type "1 Ne 1" in search box
2. Click "1 Nephi 1:1" from results
3. Use Previous/Next to browse chapter verses
4. Click "Go Live" when ready
```

### Workflow 2: Phrase Search
```
1. Type "faith" in search box
2. Browse through 50 results
3. Click interesting verses to stage
4. Click "Go Live"
5. Use Previous/Next to see surrounding verses
```

### Workflow 3: Multi-Verse Presentation
```
1. Search for and stage first verse
2. Go Live with "Go Live" button
3. Use Previous/Next to navigate forward
4. When reaching end of chapter, search for next chapter/book
5. Stage new passage
6. Go Live when ready (clients fade transition)
```

### Workflow 4: Create Themed Presentation
```
1. Click "Light" or "Dark" theme
2. Customize with background URL if desired
3. Save theme with meaningful name
4. Search for multiple verses
5. Use saved theme for all verses
6. Adjust theme during presentation as needed
```

## Supported Book Abbreviations

### Book of Mormon
- `1 ne` → 1 Nephi
- `2 ne` → 2 Nephi
- `3 ne` → 3 Nephi
- `4 ne` → 4 Nephi
- `alma` → Alma
- `hel` → Helaman
- `mosiah` → Mosiah
- (Plus Jacob, Enos, Jarom, Omni, Words of Mormon, Moroni)

### Doctrine and Covenants
- `d&c` → Doctrine and Covenants
- `dc` → Doctrine and Covenants
- `doc` → Doctrine and Covenants

### New Testament
- `matt` → Matthew
- `mark` → Mark
- `luke` → Luke
- `john` → John
- `rom` → Romans
- `1 cor` → 1 Corinthians
- `2 cor` → 2 Corinthians
- `gal` → Galatians
- `eph` → Ephesians
- `phil` → Philippians
- `col` → Colossians
- `1 thes` → 1 Thessalonians
- `2 thes` → 2 Thessalonians
- `1 tim` → 1 Timothy
- `2 tim` → 2 Timothy
- `titus` → Titus
- `heb` → Hebrews
- `james` → James
- `1 pet` → 1 Peter
- `2 pet` → 2 Peter
- `1 jn` → 1 John
- `2 jn` → 2 John
- `3 jn` → 3 John
- `jude` → Jude
- `rev` → Revelation

### Old Testament
- `gen` → Genesis
- `ex` → Exodus
- `lev` → Leviticus
- `num` → Numbers
- `deut` → Deuteronomy
- `josh` → Joshua
- `judg` → Judges
- `ruth` → Ruth
- `1 sam` → 1 Samuel
- `2 sam` → 2 Samuel
- `1 kg` → 1 Kings
- `2 kg` → 2 Kings
- `1 chr` → 1 Chronicles
- `2 chr` → 2 Chronicles
- `ezra` → Ezra
- `neh` → Nehemiah
- `esth` → Esther
- `job` → Job
- `ps` → Psalms
- `prov` → Proverbs
- `eccl` → Ecclesiastes
- `isa` → Isaiah
- `jer` → Jeremiah
- `lam` → Lamentations
- `ezek` → Ezekiel
- `dan` → Daniel
- `hos` → Hosea
- `joel` → Joel
- `amos` → Amos
- `obad` → Obadiah
- `jonah` → Jonah
- `micah` → Micah
- `nahum` → Nahum
- `hab` → Habakkuk
- `zeph` → Zephaniah
- `hag` → Haggai
- `zech` → Zechariah
- `mal` → Malachi

## Client Display Features

Clients connected to the system see:
- **Large, centered scripture verse**
- **Auto-scaling text** (shrinks if verse is very long)
- **Smooth fade transitions** when verse changes
- **Theme colors and backgrounds** matching presenter selection
- **Responsive layout** (works on tablets, projectors, TVs)

## Tips & Tricks

1. **Use Abbreviations:** They're faster to type than full names
2. **Browse with Previous/Next:** After going live, use navigation to explore surrounding verses
3. **Save Themes:** Create themed sets for different occasions (holidays, seasons, etc.)
4. **Phrase Search:** Type words you remember, don't worry about exact reference
5. **History:** Quickly return to recently-displayed verses by clicking history panel
6. **Multiple Clients:** Add multiple browser windows/tabs to display on different screens

## Troubleshooting

**Search Not Working?**
- Make sure backend is running (check for errors in terminal)
- Verify database file exists at `resources/db/lds-scriptures-sqlite.db`

**Verses Not Broadcasting to Client?**
- Check that client and presenter are connected to same backend
- Look for Socket.IO connection messages in browser console
- Verify both are using correct localhost/server address

**Theme Not Applying?**
- Click theme button again to ensure selection
- Check that custom background URL is valid (try a public image URL)
- Try built-in themes (Light/Dark) first to verify functionality

**Slow Search Results?**
- Phrase searches with common words return many results
- Use more specific phrases or book abbreviations for faster results

## Future Enhancements

- [ ] Voice search input
- [ ] Session tokens for security
- [ ] Advanced search filters (book, chapter range)
- [ ] Service Worker for offline resilience
- [ ] Search analytics and favorites
- [ ] Multimedia backgrounds (videos)
- [ ] Collaborative session support

## Support

For issues or questions:
1. Check the backend logs (terminal output)
2. Open browser developer console (F12) for client errors
3. Verify database file integrity
4. Run backend tests: `cd backend && npm test`
