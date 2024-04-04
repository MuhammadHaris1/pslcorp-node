const bcrypt = require('bcrypt');
const { db } = require('../../utils/db');
const stripe = require('../../utils/stripe');

function findUserByEmail(email) {
  return db.user.findUnique({
    where: {
      email,
    },
  });
}

function createUserByEmailAndPassword(user) {
  user.password = bcrypt.hashSync(user.password, 12);
  return db.user.create({
    data: user,
  });
}

function findUserById(id) {
  return db.user.findUnique({
    where: {
      id,
    },
    include: {
      StripeCustomer: true,
      StripeConnectedAccount: true
    }
  });
}

async function createStripeCustomer(email) {
  const customers = await stripe.customers.list({
    email
  });
  const stripeCustomer = customers.data[0];
  if (stripeCustomer) {
    return stripeCustomer
  } else {
    return stripe.customers.create({
      email,
    });
  }
}

function retrieveStripeCustomer(customerId) {
  return stripe.customers.retrieve(customerId);
}

async function getCards(customerId) {
  try {
    // const customer = await stripe.customers.retrieve(customerId, {
    //   expand: ['default_payment_method', 'payment_methods']
    // });
    const customer = await stripe.customers.retrieve(customerId)
    
    const paymentMethods = await stripe.customers.listPaymentMethods(customerId);
    // console.log('paymentMethods', paymentMethods)
    // Return an array containing basic card details (without sensitive information)
    if (customer?.invoice_settings?.default_payment_method) {
      const pm = await stripe.paymentMethods.retrieve(customer?.invoice_settings?.default_payment_method)

      const obj = {
        id: pm.id,
        brand: pm.card.brand,
        last4: pm.card.last4, // Truncated for security
        exp_month: pm.card.exp_month,
        exp_year: pm.card.exp_year,
        name: pm.billing_details.name,
        isPrimary: true
      }
      return [obj, ...paymentMethods.data.map((pm) => ({
        id: pm.id,
        brand: pm.card.brand,
        last4: pm.card.last4, // Truncated for security
        exp_month: pm.card.exp_month,
        exp_year: pm.card.exp_year,
        name: pm.billing_details.name,
        isPrimary: customer.invoice_settings.default_payment_method === pm.id
      })).filter(v => customer.invoice_settings.default_payment_method !== v.id)];
    } else {
      return [...paymentMethods.data.map((pm) => ({
        id: pm.id,
        brand: pm.card.brand,
        last4: pm.card.last4, // Truncated for security
        exp_month: pm.card.exp_month,
        exp_year: pm.card.exp_year,
        name: pm.billing_details.name,
        isPrimary: customer.invoice_settings.default_payment_method === pm.id
      })).filter(v => customer.invoice_settings.default_payment_method !== v.id)];
    }
  } catch (error) {
    console.error(error);
    throw new Error('Failed to list cards');
  }
}

async function getCardById(customerId, cardId) {
  try {
    const card = await stripe.customers.retrievePaymentMethod(customerId, cardId);

    // const card = customer.payment_methods.find((pm) => pm.id === cardId);

    if (!card) {
      throw new Error('Card not found');
    }

    // Return basic card details (without sensitive information)
    return {
      id: card.id,
      brand: card.card.brand,
      last4: card.card.last4, // Truncated for security
      exp_month: card.card.exp_month,
      exp_year: card.card.exp_year
    };
  } catch (error) {
    // console.error(error);
    // Handle errors appropriately, e.g., return a 404 status code
    return null;
  }
}

async function retrieveCustomer(customerId) {
  try {
    const customer = await stripe.customers.retrieve(customerId, {
      expand: ['default_payment_method']
    });
    return customer;
  } catch (error) {
    throw new Error('Failed to retrieve customer');
  }
}

async function getCardToRemove(customerId, cardId) {
  const customer = await retrieveCustomer(customerId);

  if (cardId) {
    // User-specified card removal
    return customer.payment_methods.find((pm) => pm.id === cardId);
  }
  // Default card removal
  return customer.default_payment_method;
}

async function detachCard(paymentMethodId) {
  try {
    await stripe.paymentMethods.detach(paymentMethodId);
    // console.log('Card successfully detached!');
  } catch (error) {
    // console.error(error);
    throw new Error('Failed to detach card');
  }
}

async function getWalletBalance(customerId) {
  try {
    const customer = await stripe.customers.retrieve(customerId, {
      expand: ['balance'] // Expand the 'balance' property for direct retrieval
    });

    const walletBalance = customer.balance; // Assumes balance property exists (verify in API docs)

    return walletBalance;
  } catch (error) {
    console.error(error);
    throw new Error('Failed to retrieve wallet balance');
  }
}

async function createStripeConnectedAccount(userId, countryIsoCode, refreshUrl, returnUrl) {
  try {
    const check = await db.stripeConnectedAccount.findFirst({
      where: { userId }
    });
    let flag = false; let account;
    if (check) {
      account = await stripe.accounts.retrieve(check.id);
      if (account) {
        if (account.check && account.payouts_enabled) return Error('StripeConnectedAccount is already exists');
        flag = true;
      } else {
        await db.stripeConnectedAccount.delete({
          where: { id: check.id }
        });
      }
    }
    if (!flag) {
      account = await stripe.accounts.create({
        type: 'express',
        country: countryIsoCode,
        business_type: 'individual'
      });
      await db.stripeConnectedAccount.create({
        data: {
          id: account.id,
          user: { connect: { id: userId } }
        }
      });
    }

    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });
    return accountLink.url;
  } catch (error) {
    // console.log(error);
    throw new Error(error);
  }
}

module.exports = {
  findUserByEmail,
  findUserById,
  createUserByEmailAndPassword,
  createStripeCustomer,
  retrieveStripeCustomer,
  getCards,
  getCardById,
  detachCard,
  getCardToRemove,
  getWalletBalance,
  createStripeConnectedAccount
};
