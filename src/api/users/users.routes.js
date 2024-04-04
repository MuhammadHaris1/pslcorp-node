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
      stripeAccount: user?.StripeConnectedAccount?.id,
    });
    const { available } = balance;
    // const totalBalance = available + pending;
    // const connectAcc = await stripe.accounts.retrieve(user.StripeConnectedAccount.id);
    // console.log(balance);
    delete user.password;
    res.json({
      ...user,
      balance: stripeCustomer?.balance,
      availableBalance: user?.StripeConnectedAccount?.id ? available?.[0]?.amount / 100 : 0
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

router.post("/makeCardPrimary", isAuthenticated, async (req, res, next) =>{ 
  try {
    const { paymentMethodId } = req.body;
    const { userId } = req.payload;
    const user = await findUserById(userId);
    if (!user) {
      res.status(400);
      throw new Error('User not found.');
    }
    if (!paymentMethodId) {
      res.status(400);
      throw new Error('paymentMethodId is required.');
    }

    await stripe.customers.update(user.StripeCustomer.id, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });

    return res.json({ message: "Make card primary successfull" })
  } catch (error) {
    next(err);
  }
})

router.post('/removeCard', isAuthenticated, async (req, res, next) => {
  try {
    const { paymentMethodId } = req.body;
    const { userId } = req.payload;
    const user = await findUserById(userId);
    if (!user) {
      res.status(400);
      throw new Error('User not found.');
    }
    if (!paymentMethodId) {
      res.status(400);
      throw new Error('paymentMethodId is required.');
    }

    // const paymentMethodToRemove = await getCardToRemove(customerId, cardId);
    await detachCard(paymentMethodId);

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
    console.log(error);
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
    const { data } = await stripe.paymentIntents.list({
      customer: user.StripeCustomer.id
    });

    const invoices = []

    for (let index = 0; index < data.length; index++) {
      const val = data[index];
      const paymentMethod = await stripe.paymentMethods.retrieve(val.payment_method)
      const invoice = {
        id: val.id,
        status: val.status,
        amount: val.amount / 100,
        created: val.created,
        currency: val.currency,
        // paymentMethod,
        card: paymentMethod.card
      }
      invoices.push(invoice)
    }
    // const invoices = data.map((val) => {
    //   // const paymentMethod = await stripe.paymentMethod.retrieve(val.payment_method)
    //   return ({
    //     id: val.id,
    //     status: val.status,
    //     amount: val.amount / 100,
    //     created: val.created,
    //     currency: val.currency,
    //     // paymentMethod
    //   })
    // })

    res.send({ data: invoices, status: true });
  } catch (error) {
    next(error);
  }
});

router.post('/updateAutoRechargeWith', isAuthenticated, async (req, res, next) => {
  try {
    const { userId } = req.payload;
    const { amount } = req.body;
    const user = await findUserById(userId);
    if (!amount) {
      throw new Error("Amount is required.")
    }
    if (!user) {
      throw new Error(" is required.")
    }

    const updatedUser = await db.user.update({
      where: {
        id: userId
      },
      data: {
        autoRechargeWith: Number(amount)
      }
    })

    res.send({ data: updatedUser });
  } catch (error) {
    // console.log(error)
    next(error);
  }
});

router.post('/updateBalanceLowerThan', isAuthenticated, async (req, res, next) => {
  try {
    const { userId } = req.payload;
    const { amount } = req.body;
    const user = await findUserById(userId);
    if (!amount) {
      throw new Error("Amount is required.")
    }
    if (!user) {
      throw new Error(" is required.")
    }

    const updatedUser = await db.user.update({
      where: {
        id: userId
      },
      data: {
        balanceLowerThan: Number(amount)
      }
    })

    res.send({ data: updatedUser });
  } catch (error) {
    // console.log(error)
    next(error);
  }
});

router.post("/createChargeFromBalance", isAuthenticated, async (req, res, next) => {
  try {
    const { userId } = req.payload;
    const { amount } = req.body;
    const account = await stripe.accounts.retrieve();


    const user = await findUserById(userId);
    if (!amount) {
      throw new Error("Amount is required.")
    }
    if (!user) {
      throw new Error(" is required.")
    }

    // return res.json({account})
    const charge = await stripe.charges.create({
      amount: amount * 100,
      currency: 'usd',
      source: user.StripeConnectedAccount.id,
      description: 'Direct charge from connected account to platform',
    });


    // if (charge.status === 'succeeded') {
    //   const account = await stripe.accounts.retrieve();
    //   // Transfer the charged amount to your platform's Stripe account
    //   const transfer = await stripe.transfers.create({
    //     amount: amount * 100,
    //     currency: 'usd',
    //     destination: account.id, // ID of your platform's Stripe account
    //     source_transaction: charge.id, // ID of the charge on the connected account
    //   });

    //   // Handle the transfer response
    //   if (transfer.status === 'pending') {
    //     console.log('Direct charge and transfer successful!');
    //   } else {
    //     console.log('Direct charge successful, but transfer failed.');
    //   }
    // } else {
    //   console.log('Direct charge failed.');
    // }

    const balance = await stripe.balance.retrieve({
      stripeAccount: user.StripeConnectedAccount.id,
    });
    const { available } = balance;
    const availableBalance = available[0].amount / 100

    if (availableBalance < user.balanceLowerThan) {
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
        amount: Number(user.autoRechargeWith) * 100,
        currency: 'usd', // Replace with your desired currency
        customer: user.StripeCustomer.id,
        payment_method: paymentMethodId,
        payment_method_types: ['card'], // Optional: Allow payment from wallet balance
        confirm: true,
      });
      await stripe.transfers.create({
        amount: intent.amount,
        currency: intent.currency,
        destination: user.StripeConnectedAccount.id
      });
    }
    res.send({
      message: "charge created",
      charge
    })
  } catch (error) {
    next(error)
  }
})

module.exports = router;
