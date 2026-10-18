const config = require('./config');
const { CoordinadoraError } = require('./errors');
const { CoordinadoraOAuth } = require('./auth');
const quote = require('./quote');
const dane = require('./dane');
const packageProfiles = require('./packageProfiles');
const nationalShippingQuote = require('./nationalShippingQuote');

module.exports = {
  ...config,
  CoordinadoraError,
  CoordinadoraOAuth,
  ...quote,
  ...dane,
  ...packageProfiles,
  ...nationalShippingQuote,
};
