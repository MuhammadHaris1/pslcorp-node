const express = require("express");
const { isAuthenticated } = require("../../middlewares");
const { findUserById, retrieveStripeCustomer } = require("./users.services");

const router = express.Router();

router.get("/profile", isAuthenticated, async (req, res, next) => {
  try {
    const { userId } = req.payload;
    const user = await findUserById(userId);
    const stripeCustomer = await retrieveStripeCustomer(user.StripeCustomer.id);
    delete user.password;
    res.json({ ...user, balance: stripeCustomer.balance });
  } catch (err) {
    console.log(err)
    next(err);
  }
});

module.exports = router;
