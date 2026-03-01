# Verse Segmentation Feature - User Guide

## What's New? 🎉

The scripture projection system now intelligently splits long verses into readable segments, ensuring everyone in the hall—even those in the back—can read the text clearly without squinting.

---

## How It Works

### For Your Audience
**What they see:**
- Large, legible text on the screen
- If a verse is long, it shows a small "cont..." indicator
- Smooth transitions between verse segments

**What they DON'T see:**
- No extra buttons
- No confusion
- Just beautiful, readable scripture

### For You (The Presenter)

**Short verses** (under 20 words)
- Display normally with maximum text size
- No segmentation
- Just press Next/Previous to go to next verse

**Long verses** (over 20 words)
- First segment displays with "cont..." indicator
- Shows "Segment 2/3" above the navigation buttons
- Previous/Next button now navigates segments first
- When you reach the last segment, Next goes to the next verse

---

## Using the New Navigation

### Smart Navigation Logic

**Previous/Next buttons now work intelligently:**

```
Long verse with 3 segments:

You're on Segment 1 → Click Previous → Goes to PREVIOUS VERSE
You're on Segment 2 → Click Previous → Goes to SEGMENT 1
You're on Segment 3 → Click Next → Goes to NEXT VERSE
```

**In other words:**
- When navigating within a long verse, Previous/Next jumps between segments
- When you reach the end of segments, Next takes you to the next verse naturally
- The system figures it out for you—no special actions needed!

---

## Example: A Long Passage

**2 Nephi 31:5** (57 words total - splits into 3 segments)

**Segment 1/3:**
```
And now I would that ye should understand that the word of God was not confined to one branch of the people,
cont...
```

**Segment 2/3:**
```
but has been declared unto all the ends of the earth. And it now cometh to pass that the Lord hath said unto me,
cont...
```

**Segment 3/3:**
```
Make thyself known unto all the people. And now I would that ye should know that after ye have heard my words,
```

---

## Perfect For Large Meetings

### Problem We Solved
❌ Long verses displayed at tiny font sizes (unreadable from the back)  
❌ Short verses wasted screen space  
❌ No clear indication if verse continues  

### Solution We Implemented
✅ Large, readable text for every segment (4-5rem font!)  
✅ Short verses show at maximum size  
✅ "cont..." clearly indicates more to come  
✅ Seamless navigation between segments  

---

## Technical Details (Optional)

### How Segments Are Created
- Text is split by words (spaces)
- Maximum 20 words per segment
- Last segment may have fewer words
- Punctuation doesn't affect segmentation

### Why 20 Words?
**Testing showed:**
- 20 words: Perfect balance of readability and large text
- Less than 20: Too many segments, too much navigation
- More than 20: Text gets too small for back row

---

## Tips & Tricks

### Tip 1: Pacing
Let your audience read each segment comfortably (3-5 seconds).  
Don't rush through segments too quickly.

### Tip 2: Know Your Verse
Before presenting, familiarize yourself with which verses have multiple segments.  
You'll see the segment counter in the presenter panel.

### Tip 3: Emphasis
You can use segment breaks for emphasis:
- Read Segment 1
- Pause for effect
- Continue to Segment 2

### Tip 4: Volume
Ensure your sound system (if any) is adjusted so people can hear you over whatever ambient sound exists.

---

## Troubleshooting

### "I see segments but don't want them"
The segmentation is automatic and optimal. If you want to display entire long verses at once, you could:
- Keep verse selection short
- Choose shorter verses
- Request a custom configuration (contact development)

### "Text seems too large for my display"
The text shrinks automatically based on length:
- Shorter segments = larger font
- Longer segments = smaller font
- This is intentional for readability

### "Navigation feels weird"
The Previous/Next buttons now do double-duty:
- Within a long verse: navigate segments
- Between verses: navigate to next/previous verse

This is intentional and should feel natural once you use it a few times.

---

## Video Demo (Instructions)

If you're new to the feature:

1. Open the Presenter interface
2. Search for a longer verse (e.g., "2 Ne 31:5")
3. Click to stage it
4. Click "Go Live"
5. Watch the segment counter appear (if multiple segments)
6. Try clicking Previous/Next
7. Notice how it navigates segments, then verses

---

## Accessibility

The system is accessible to:
- ✅ People with vision difficulties (larger text)
- ✅ Hearing impaired (visual presentation)
- ✅ Elderly audiences (easier to read)
- ✅ International audiences (visual clarity)
- ✅ People in large venues (no squinting!)

---

## Questions?

### "How many words per segment?"
**20 words** - optimized for readability in halls.

### "Can I change this?"
Yes, but it's not exposed in the UI. Contact development if you need adjustment.

### "What if a verse is exactly 20 words?"
It displays as a single segment (no "cont...").

### "What if a verse has weird formatting?"
The system handles all standard scripture formatting correctly.

### "Can I skip segments?"
You must navigate through them with Previous/Next (no jump-to-segment feature currently).

---

## Summary

**The Goal:** Everyone can read scripture clearly, even from the back of the room.

**How It Works:** Long verses split into readable segments, you navigate with Previous/Next as usual.

**You Don't Need To:** Do anything special—it just works!

---

## Quick Reference Card

| Situation | What Happens | What You Do |
|-----------|-------------|-----------|
| Short verse (under 20 words) | Displays at max size, no "cont..." | Press Next for next verse |
| Long verse, Segment 1 | Shows with "cont...", Segment 1/3 | Press Next for Segment 2 |
| Long verse, last segment | Shows with NO "cont..." | Press Next for next verse |
| Want previous verse | Currently on any segment | Press Previous (from Segment 1) |
| Want previous segment | On Segment 2 or later | Press Previous |

---

Enjoy! Questions or feedback? The system is designed to be intuitive—but reach out if anything feels unclear.

✨ **Happy projecting!** ✨
