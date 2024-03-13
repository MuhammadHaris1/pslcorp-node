const bcrypt = require("bcrypt");
const { db } = require("../../utils/db");
const stripe = require("../../utils/stripe");

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
      StripeCustomer: true
    }
  });
}

function createStripeCustomer(email) {
  return stripe.customers.create({
    email: email,
  })
}

function retrieveStripeCustomer(customerId) {
  return stripe.customers.retrieve(customerId)
}

module.exports = {
  findUserByEmail,
  findUserById,
  createUserByEmailAndPassword,
  createStripeCustomer,
  retrieveStripeCustomer,
};
