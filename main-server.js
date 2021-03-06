import './check-npm.js';

import { graphqlExpress, graphiqlExpress } from 'graphql-server-express';
import bodyParser from 'body-parser';
import express from 'express';
import { createServer } from 'http';
import { Meteor } from 'meteor/meteor';
import { WebApp } from 'meteor/webapp';
import { check } from 'meteor/check';
import { Accounts } from 'meteor/accounts-base';
import { _ } from 'meteor/underscore';
import { SubscriptionServer } from 'subscriptions-transport-ws';

export { createMeteorNetworkInterface, meteorClientConfig } from './main-client';

const defaultConfig = {
  path: '/graphql',
  maxAccountsCacheSizeInMB: 1,
  graphiql: Meteor.isDevelopment,
  graphiqlPath: '/graphiql',
  graphiqlOptions: {
    passHeader: "'Authorization': localStorage['Meteor.loginToken']"
  },
  useSubscription: true,
  subscriptionPort: 8080,
  configServer: (graphQLServer) => { },
};

const defaultOptions = {
  formatError: e => ({
    message: e.message,
    locations: e.locations,
    path: e.path
  }),
};

if (Meteor.isDevelopment) {
  defaultOptions.debug = true;
}

export const createApolloServer = (givenOptions = {}, givenConfig = {}) => {
  const { subscriptionManager, ...restOfConfig } = givenConfig;
  let graphiqlOptions = Object.assign({}, defaultConfig.graphiqlOptions, restOfConfig.graphiqlOptions);
  let config = Object.assign({}, defaultConfig, restOfConfig);
  config.graphiqlOptions = graphiqlOptions;

  const graphQLServer = express();

  config.configServer(graphQLServer)

  // GraphQL endpoint
  graphQLServer.use(config.path, bodyParser.json(), graphqlExpress(async (req) => {
    let options,
      user = null;

    if (_.isFunction(givenOptions))
      options = givenOptions(req);
    else
      options = givenOptions;

    // Merge in the defaults
    options = Object.assign({}, defaultOptions, options);
    if (options.context) {
      // don't mutate the context provided in options
      options.context = Object.assign({}, options.context);
    } else {
      options.context = {};
    }

    // Get the token from the header
    if (req.headers.authorization) {
      const token = req.headers.authorization;
      check(token, String);
      const hashedToken = Accounts._hashLoginToken(token);

      // Get the user from the database
      user = await Meteor.users.findOne(
        { "services.resume.loginTokens.hashedToken": hashedToken }
      );

      if (user) {
        const loginToken = _.findWhere(user.services.resume.loginTokens, { hashedToken });
        const expiresAt = Accounts._tokenExpiration(loginToken.when);
        const isExpired = expiresAt < new Date();

        if (!isExpired) {
          options.context.userId = user._id;
          options.context.user = user;
        }
      }
    }

    return options;
  }));

  // Start GraphiQL if enabled
  if (config.graphiql) {
    graphQLServer.use(config.graphiqlPath, graphiqlExpress(_.extend(config.graphiqlOptions, { endpointURL: config.path })));
  }


  // This binds the specified paths to the Express server running Apollo + GraphiQL
  WebApp.connectHandlers.use(Meteor.bindEnvironment(graphQLServer));

  // Add subscriptionManager here
  if (config.useSubscription) {
    if (!subscriptionManager) {
      throw new Meteor.Error('SubscriptionManager which is mandatory missing.');
    }
    try {
      // create http server for subscription
      // const server = createServer(graphQLServer);
      // Create WebSocket listener server
      const server = createServer((request, response) => {
        response.writeHead(404);
        response.end();
      });
      server.listen(config.subscriptionPort, () => {
        console.log('Subscription manager running ' + config.subscriptionPort);
      });
      const subscriptionServer = new SubscriptionServer({
        subscriptionManager,
      }, {
          server,
          path: '/'
        });
    } catch (e) {
      console.log(e);
    }
  }
};
