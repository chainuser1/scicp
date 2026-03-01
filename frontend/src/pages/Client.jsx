import React, { useState, useEffect } from 'react';
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

  useEffect(() => {
    const handleVerse = (data) => {
      setAnimating(true);
      setTimeout(() => {
        setVerse(data);
        setAnimating(false);
      }, 500);
    };
    const handleTheme = (theme) => {
      setAnimating(true);
      setTimeout(() => {
        setVerse((v) => ({ ...v, theme }));
        setAnimating(false);
      }, 500);
    };

    socket.on('update-verse', handleVerse);
    socket.on('update-theme', handleTheme);
    socket.on('highlight-text', (text) => {
      setHighlightedText(text);
    });

    return () => {
      socket.off('update-verse', handleVerse);
      socket.off('update-theme', handleTheme);
      socket.off('highlight-text');
    };
  }, []);

  // Determine what text to display (segment or full text)
  const displayText = verse.segments && verse.segments.length > 0
    ? verse.segments[verse.currentSegment] || verse.scripture_text
    : verse.scripture_text;

  const hasMoreSegments = verse.segments && verse.currentSegment < verse.segments.length - 1;

  // Render text with highlighting
  const renderHighlightedText = () => {
    if (!highlightedText) return displayText;
    const parts = displayText.split(new RegExp(`(${highlightedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return parts.map((part, idx) => 
      part.toLowerCase() === highlightedText.toLowerCase() 
        ? <span key={idx} className="highlight-yellow">{part}</span>
        : part
    );
  };

  const base = parseFloat(verse.theme?.font_size) || 4;
  const length = displayText.length;
  let calculated = base - length / 100;
  if (calculated < 1.5) calculated = 1.5;
  const computedFontSize = `${calculated}rem`;

  const themeStyles = {
    backgroundImage: verse.theme?.background_url,
    fontFamily: verse.theme?.font_family,
    fontSize: computedFontSize,
  };

  return (
    <div
      className={`client-view ${verse.theme?.layout} ${animating ? 'fade' : ''}`}
      style={themeStyles}
    >
      <span className="verse-title-top-left">{verse.verse_title}</span>
      <div className="verse-content">
        <p>{renderHighlightedText()}</p>
        {/* Show "cont" indicator if more segments exist */}
        {hasMoreSegments && <div className="cont-indicator">cont...</div>}
      </div>
    </div>
  );
}

export default Client;
