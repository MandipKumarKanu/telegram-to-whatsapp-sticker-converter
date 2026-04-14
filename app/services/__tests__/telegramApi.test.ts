import { mapTelegramErrorMessage } from '../telegramApi';

describe('mapTelegramErrorMessage', () => {
  it('maps timeout errors', () => {
    expect(mapTelegramErrorMessage('Request timed out.')).toContain('timed out');
  });

  it('maps 429 errors', () => {
    expect(mapTelegramErrorMessage('Too Many Requests', 429)).toContain('rate limiting');
  });

  it('maps sticker set invalid errors', () => {
    expect(mapTelegramErrorMessage('Bad Request: STICKERSET_INVALID')).toContain('not found');
  });
});
