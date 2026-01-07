'use strict';

const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

module.exports = {
  init(providerOptions = {}, settings = {}) {
    const client = new SESClient({
      region: providerOptions.region || 'us-east-1',
      credentials: providerOptions.credentials,
    });

    return {
      send: async (options) => {
        const { from, to, cc, bcc, replyTo, subject, text, html } = options;

        const destination = {
          ToAddresses: Array.isArray(to) ? to : [to],
        };

        if (cc) {
          destination.CcAddresses = Array.isArray(cc) ? cc : [cc];
        }

        if (bcc) {
          destination.BccAddresses = Array.isArray(bcc) ? bcc : [bcc];
        }

        const message = {
          Subject: { Data: subject },
          Body: {},
        };

        if (html) {
          message.Body.Html = { Data: html };
        }

        if (text) {
          message.Body.Text = { Data: text };
        }

        const command = new SendEmailCommand({
          Source: from || settings.defaultFrom,
          Destination: destination,
          Message: message,
          ReplyToAddresses: replyTo ? (Array.isArray(replyTo) ? replyTo : [replyTo]) : undefined,
        });

        try {
          const response = await client.send(command);
          return response;
        } catch (error) {
          throw new Error(`SES email send failed: ${error.message}`);
        }
      },
    };
  },
};
