import { describe, expect, it } from 'vitest';
import { rootDomain } from '../src/core/domain';

describe('rootDomain', () => {
  it.each([
    ['https://www.google.com/search?q=x', 'google.com'],
    ['https://mail.google.com/mail/u/0/', 'google.com'],
    ['https://news.bbc.co.uk/sport', 'bbc.co.uk'],
    ['https://bbc.co.uk', 'bbc.co.uk'],
    ['https://foo.github.io/project', 'foo.github.io'],
    ['https://bar.foo.github.io/', 'foo.github.io'],
    ['https://github.com/adi-dibra', 'github.com'],
    ['https://shop.example.com.au/cart', 'example.com.au'],
    ['https://WWW.Example.COM/Path', 'example.com'],
    ['http://example.com:8080/x', 'example.com'],
    ['https://myapp.herokuapp.com', 'myapp.herokuapp.com'],
    ['https://s3.amazonaws.com/bucket', 's3.amazonaws.com'],
  ])('%s -> %s', (url, want) => {
    expect(rootDomain(url)).toBe(want);
  });

  it('keeps IP addresses and single-label hosts as is', () => {
    expect(rootDomain('http://192.168.1.10:3000/')).toBe('192.168.1.10');
    expect(rootDomain('http://[::1]:8080/')).toBe('::1');
    expect(rootDomain('http://localhost:5173/')).toBe('localhost');
    expect(rootDomain('http://intranet/wiki')).toBe('intranet');
  });

  it('buckets non-web URLs by scheme', () => {
    expect(rootDomain('chrome://settings')).toBe('chrome://');
    expect(rootDomain('chrome-extension://abc/page.html')).toBe('chrome-extension://');
    expect(rootDomain('file:///C:/Users/me/doc.pdf')).toBe('file://');
    expect(rootDomain('about:blank')).toBe('about:');
    expect(rootDomain('data:text/plain,hi')).toBe('data:');
  });

  it('handles missing and invalid input', () => {
    expect(rootDomain(undefined)).toBe('(no url)');
    expect(rootDomain('')).toBe('(no url)');
    expect(rootDomain('not a url')).toBe('(invalid url)');
    expect(rootDomain('https://')).toBe('(invalid url)');
  });

  it('handles internationalized domains', () => {
    expect(rootDomain('https://www.münchen.de/')).toBe('xn--mnchen-3ya.de');
  });
});
