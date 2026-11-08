export function authFailure(text) {
  return text.match(/\b(?:401 unauthorized|status 401|unauthorized|not logged in|please log in|login required|authentication failed|invalid api key|api key not found|no credentials)\b/i)?.[0].toLowerCase() ?? '';
}
