import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

describe('Mobile Scrollbar Visual Suppression Contract', () => {
  const indexCssPath = path.join(process.cwd(), 'src/index.css');
  const tokensCssPath = path.join(process.cwd(), 'src/styles/tokens.css');
  const indexHtmlPath = path.join(process.cwd(), 'index.html');

  const indexCssContent = fs.readFileSync(indexCssPath, 'utf8');
  const tokensCssContent = fs.readFileSync(tokensCssPath, 'utf8');
  const indexHtmlContent = fs.readFileSync(indexHtmlPath, 'utf8');

  it('1. Mobile media query targets real mobile phones (@media (max-width: 1023px), (pointer: coarse))', () => {
    assert.ok(
      indexCssContent.includes('@media (max-width: 1023px), (pointer: coarse)'),
      'index.css must include mobile query matching phone widths and touch pointers'
    );
    assert.ok(
      tokensCssContent.includes('@media (max-width: 1023px), (pointer: coarse)'),
      'tokens.css must include mobile query matching phone widths and touch pointers'
    );
  });

  it('2. Inside mobile query, hides scrollbar chrome via scrollbar-width, -ms-overflow-style, and webkit-scrollbar', () => {
    // Extract mobile block from index.css
    const mobileBlockMatch = indexCssContent.match(/@media\s*\(max-width:\s*1023px\),\s*\(pointer:\s*coarse\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(mobileBlockMatch, 'Mobile media query block must be present');
    const mobileBlock = mobileBlockMatch[1];

    assert.ok(
      mobileBlock.includes('scrollbar-width: none'),
      'Must declare scrollbar-width: none for Firefox mobile'
    );
    assert.ok(
      mobileBlock.includes('-ms-overflow-style: none'),
      'Must declare -ms-overflow-style: none for legacy engines'
    );
    assert.ok(
      mobileBlock.includes('display: none'),
      'Must set display: none on webkit scrollbar'
    );
    assert.ok(
      mobileBlock.includes('width: 0') && mobileBlock.includes('height: 0'),
      'Must collapse webkit scrollbar dimensions to 0'
    );
  });

  it('3. Invariant: overflow: hidden is NEVER set on body as a way to hide the scrollbar', () => {
    // Check index.html body element
    const bodyTagMatch = indexHtmlContent.match(/<body[^>]*>/i);
    assert.ok(bodyTagMatch, 'body tag must exist in index.html');
    assert.strictEqual(
      bodyTagMatch[0].includes('overflow-hidden'),
      false,
      'body tag must NOT have overflow-hidden class'
    );

    // Check index.css body block
    const bodyCssMatch = indexCssContent.match(/body\s*\{([^}]*)\}/);
    assert.ok(bodyCssMatch, 'body CSS block must exist');
    assert.strictEqual(
      bodyCssMatch[1].includes('overflow: hidden') || bodyCssMatch[1].includes('overflow-y: hidden'),
      false,
      'body CSS block must NOT set overflow: hidden'
    );
  });

  it('4. Desktop theme rules for thin tactical scrollbar remain intact', () => {
    // Check webkit scrollbar declaration in index.css outside the mobile query
    assert.ok(
      indexCssContent.includes('::-webkit-scrollbar {') && indexCssContent.includes('width: 6px;'),
      'Desktop scrollbar width must be preserved at 6px'
    );
    assert.ok(
      indexCssContent.includes('::-webkit-scrollbar-thumb'),
      'Desktop scrollbar thumb styling must be preserved'
    );
    assert.ok(
      indexCssContent.includes('::-webkit-scrollbar-track'),
      'Desktop scrollbar track styling must be preserved'
    );
  });

  it('5. scrollbar-gutter stable is preserved on desktop and set to auto on mobile', () => {
    assert.ok(
      indexCssContent.includes('scrollbar-gutter: stable;'),
      'html element must preserve scrollbar-gutter: stable on desktop'
    );

    const mobileBlockMatch = indexCssContent.match(/@media\s*\(max-width:\s*1023px\),\s*\(pointer:\s*coarse\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(mobileBlockMatch, 'Mobile block must exist');
    assert.ok(
      mobileBlockMatch[1].includes('scrollbar-gutter: auto;'),
      'Mobile media query must set scrollbar-gutter: auto'
    );
  });

  it('6. Explicit .no-scrollbar utility class is available for selective scrollbar hiding', () => {
    assert.ok(
      indexCssContent.includes('.no-scrollbar'),
      'index.css must provide .no-scrollbar utility'
    );
    assert.ok(
      tokensCssContent.includes('.no-scrollbar'),
      'tokens.css must provide .no-scrollbar utility'
    );
  });
});
