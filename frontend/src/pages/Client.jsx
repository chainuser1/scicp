import React, { useState, useEffect, useRef } from 'react';
import { socket } from '../socket';

function Client() {
  const [verse, setVerse] = useState({
    scripture_text: 'Waiting for a scripture...',
    verse_title: '',
    segments: [],
    currentSegment: 0,
    totalSegments: 0,
    theme: {
      background_url: "url('https://images.unsplash.com/photo-1513151233558-d860c5398176?q=80&w=2070&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D')",
      font_family: "serif",
      font_size: "4rem",
      layout: "centered"
    }
  });
  const [animating, setAnimating] = useState(false);
  const [highlightedText, setHighlightedText] = useState('');
  // Key forces re-mount of label element → re-triggers arrival animation on verse change
  const [labelKey, setLabelKey] = useState(0);

  useEffect(() => {
    const handleVerse = (data) => {
      setAnimating(true);
      setTimeout(() => {
        setVerse(data);
        setLabelKey((k) => k + 1);
        setAnimating(false);
      }, 600);
    };

    const handleTheme = (theme) => {
      setAnimating(true);
      setTimeout(() => {
        setVerse((v) => ({ ...v, theme }));
        setAnimating(false);
      }, 600);
    };

    const handleHighlight = (text) => {
      setHighlightedText(text ? text.trim() : '');
    };

    socket.on('update-verse', handleVerse);
    socket.on('update-theme', handleTheme);
    socket.on('highlight-text', handleHighlight);

    return () => {
      socket.off('update-verse', handleVerse);
      socket.off('update-theme', handleTheme);
      socket.off('highlight-text', handleHighlight);
    };
  }, []);

  // Determine display text (segment or full)
  const displayText = verse.segments && verse.segments.length > 0
    ? verse.segments[verse.currentSegment] || verse.scripture_text
    : verse.scripture_text;

  const hasMoreSegments = verse.segments && verse.currentSegment < verse.segments.length - 1;

  // Render text with highlight spans (each highlighted word re-mounts → re-triggers animation)
  const renderHighlightedText = () => {
    if (!highlightedText) return displayText;
    const escaped = highlightedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = displayText.split(new RegExp(`(${escaped})`, 'gi'));
    return parts.map((part, idx) =>
      part.toLowerCase() === highlightedText.toLowerCase()
        ? <span key={`hl-${idx}-${highlightedText}`} className="highlight-yellow">{part}</span>
        : part
    );
  };

  // Responsive font sizing
  const base = parseFloat(verse.theme?.font_size) || 4;
  const length = displayText.length;
  let calculated = base - length / 100;
  if (calculated < 1.5) calculated = 1.5;
  const computedFontSize = `${calculated}rem`;

  const themeStyles = {
    backgroundImage: verse.theme?.background_url,
    fontFamily: "'Cormorant Garamond', Georgia, serif",
    fontSize: computedFontSize,
  };

  return (
    <div
      className={`client-view ${verse.theme?.layout || 'centered'} ${animating ? 'fade' : ''}`}
      style={themeStyles}
    >
      {/* Verse reference — Cinzel label, re-animates on each verse change */}
      {verse.verse_title && (
        <span key={labelKey} className="verse-title-top-left">
          {verse.verse_title}
        </span>
      )}

      <div className="verse-content">
        {/* Frosted backdrop wraps the scripture text */}
        <div className="verse-backdrop">
          <p>{renderHighlightedText()}</p>
          {hasMoreSegments && (
            <div className="cont-indicator">continues ›</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Client;