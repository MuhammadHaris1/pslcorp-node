/* eslint-disable consistent-return */
const express = require('express');
const { isAuthenticated } = require('../../middlewares');
const {
  findUserById,
  getCards,
  getCardById,
  detachCard,
  getCardToRemove,
  createStripeConnectedAccount,
  retrieveStripeCustomer
} = require('./users.services');
const stripe = require('../../utils/stripe');
const { db } = require('../../utils/db');

const router = express.Router();

router.get('/profile', isAuthenticated, async (req, res, next) => {
  try {
    const { userId } = req.payload;
    // const { email } = req.params;
    const user = await findUserById(userId);
    // const customers = await stripe.customers.list({
    //   email
    // });
    // const stripeCustomer = customers.data[0];
    // if (!stripeCustomer) {
    //   res.status(400);
    //   throw new Error('No stripe customer found with this email');
    // }
    // const accounts = await stripe.accounts.list();
    // console.log("stripeCustomer", stripeCustomer)
    const stripeCustomer = await retrieveStripeCustomer(user.StripeCustomer.id);
    const balance = await stripe.balance.retrieve({
      stripeAccount: user.StripeConnectedAccount.id,
    });
    const { available } = balance;
    // const totalBalance = available + pending;
    // const connectAcc = await stripe.accounts.retrieve(user.StripeConnectedAccount.id);
    // console.log(balance);
    delete user.password;
    res.json({
      ...user,
      balance: stripeCustomer.balance,
      availableBalance: available[0].amount / 100
      // stripeCustomer,
      // accounts
    });
  } catch (err) {
    // console.log(err)
    next(err);
  }
});

router.post('/addCard', isAuthenticated, async (req, res, next) => {
  try {
    const { paymentMethodId, isPrimary } = req.body;
    const { userId } = req.payload;
    const user = await findUserById(userId);
    if (!paymentMethodId) {
      res.status(400);
      throw new Error('paymentMethodId is required.');
    }

    await stripe.paymentMethods.attach(
      paymentMethodId,
      {
        customer: user.StripeCustomer.id,
      }
    );

    if (isPrimary) {
      await stripe.customers.update(user.StripeCustomer.id, {
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      });
    }
    res.send({ message: 'Card added successfully!' });
  } catch (err) {
    next(err);
  }
});

router.post('/removeCard', isAuthenticated, async (req, res, next) => {
  try {
    const { customerId, cardId } = req.body; // Destructure request data

    const paymentMethodToRemove = await getCardToRemove(customerId, cardId);
    await detachCard(paymentMethodToRemove.id);

    // Update user interface or database to reflect card removal
    res.send({ message: 'Card successfully removed!' });
  } catch (error) {
    next(error);
  }
});

router.get('/getCards', isAuthenticated, async (req, res, next) => {
  try {
    const { userId } = req.payload;
    const user = await findUserById(userId);
    const cards = await getCards(user.StripeCustomer.id);
    return res.json({ status: true, cards });
  } catch (error) {
    next(error);
  }
});

router.get('/getCard/:id', isAuthenticated, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { userId } = req.payload;
    const user = await findUserById(userId);

    const card = await getCardById(user.StripeCustomer.id, id);
    return res.json({ status: true, card });
  } catch (error) {
    next(error);
  }
});

router.post('/add-funds', isAuthenticated, async (req, res) => {
  try {
    const { amount } = req.body;
    const { userId } = req.payload;
    const user = await findUserById(userId);
    const stripeConnectedAccount = await db.stripeConnectedAccount.findFirst({
      where: {
        userId
      }
    });
    const customer = await stripe.customers.retrieve(user.StripeCustomer.id, {
      expand: ['invoice_settings']
    });
    const paymentMethodId = customer.invoice_settings.default_payment_method;
    // return res.json({ customer })
    if (!paymentMethodId) {
      res.status(400);
      throw new Error('No default payment method is selected');
    }
    const intent = await stripe.paymentIntents.create({
      amount: Number(amount) * 100,
      currency: 'usd', // Replace with your desired currency
      customer: user.StripeCustomer.id,
      payment_method: paymentMethodId,
      payment_method_types: ['card'], // Optional: Allow payment from wallet balance
      confirm: true,
    });
    await stripe.transfers.create({
      amount: intent.amount,
      currency: intent.currency,
      destination: stripeConnectedAccount.id
    });

    // Update the user's wallet balance accordingly (store it securely)
    res.send({ message: 'payment transfer successfully' });
  } catch (error) {
    // console.log(error);
    res.status(500).send({ error: 'Failed to add funds' });
  }
});

router.post('/createStripeConnectAccount', isAuthenticated, async (req, res, next) => {
  try {
    const { userId } = req.payload;
    const { countryIsoCode, refreshUrl, returnUrl } = req.body;
    const url = await createStripeConnectedAccount(userId, countryIsoCode, refreshUrl, returnUrl);
    return res.json({ url });
  } catch (error) {
    next(error);
  }
});

router.get('/getBillingHistory', isAuthenticated, async (req, res, next) => {
  try {
    const { userId } = req.payload;
    const user = await findUserById(userId);
    const invoices = await stripe.invoices.list({
      customer: user.StripeCustomer.id
    });

    res.send({ data: invoices.data });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
