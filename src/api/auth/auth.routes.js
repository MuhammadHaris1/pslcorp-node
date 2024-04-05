const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const {
  findUserByEmail,
  createUserByEmailAndPassword,
  findUserById,
  createStripeCustomer,
} = require('../users/users.services');
const { generateTokens } = require('../../utils/jwt');
const {
  addRefreshTokenToWhitelist,
  findRefreshTokenById,
  deleteRefreshToken,
  revokeTokens,
  checkEmail,
} = require('./auth.services');
const { hashToken } = require('../../utils/hashToken');
const nodemailer = require("nodemailer");
const { db } = require('../../utils/db');

const router = express.Router();

router.post('/register', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400);
      throw new Error('You must provide an email and a password.');
    }

    const existingUser = await findUserByEmail(email);

    if (existingUser) {
      res.status(400);
      throw new Error('Email already in use.');
    }
    const stripeCustomer = await createStripeCustomer(email);
    console.log(stripeCustomer);
    const user = await createUserByEmailAndPassword({
      email,
      password,
      StripeCustomer: {
        create: {
          id: stripeCustomer.id,
        },
      },
    });
    const jti = uuidv4();
    const { accessToken, refreshToken } = generateTokens(user, jti);
    await addRefreshTokenToWhitelist({ jti, refreshToken, userId: user.id });

    res.json({
      accessToken,
      refreshToken,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400);
      throw new Error('You must provide an email and a password.');
    }

    const existingUser = await findUserByEmail(email);

    if (!existingUser) {
      res.status(403);
      throw new Error('Invalid login credentials.');
    }

    const validPassword = await bcrypt.compare(password, existingUser.password);
    if (!validPassword) {
      res.status(403);
      throw new Error('Invalid login credentials.');
    }

    const jti = uuidv4();
    const { accessToken, refreshToken } = generateTokens(existingUser, jti);
    await addRefreshTokenToWhitelist({
      jti,
      refreshToken,
      userId: existingUser.id,
    });

    res.json({
      accessToken,
      refreshToken,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/refreshToken', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      res.status(400);
      throw new Error('Missing refresh token.');
    }
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const savedRefreshToken = await findRefreshTokenById(payload.jti);

    if (!savedRefreshToken || savedRefreshToken.revoked === true) {
      res.status(401);
      throw new Error('Unauthorized');
    }

    const hashedToken = hashToken(refreshToken);
    if (hashedToken !== savedRefreshToken.hashedToken) {
      res.status(401);
      throw new Error('Unauthorized');
    }

    const user = await findUserById(payload.userId);
    if (!user) {
      res.status(401);
      throw new Error('Unauthorized');
    }

    await deleteRefreshToken(savedRefreshToken.id);
    const jti = uuidv4();
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(
      user,
      jti
    );
    await addRefreshTokenToWhitelist({
      jti,
      refreshToken: newRefreshToken,
      userId: user.id,
    });

    res.json({
      accessToken,
      refreshToken: newRefreshToken,
    });
  } catch (err) {
    next(err);
  }
});

// This endpoint is only for demo purpose.
// Move this logic where you need to revoke the tokens( for ex, on password reset)
router.post('/revokeRefreshTokens', async (req, res, next) => {
  try {
    const { userId } = req.body;
    await revokeTokens(userId);
    res.json({ message: `Tokens revoked for user with id #${userId}` });
  } catch (err) {
    next(err);
  }
});

router.get("/checkEmail/:email", async (req, res, next) => {
  try {
    const { email } = req.params;
    const user = await checkEmail(email);

    if (user) {
      return res.json({ emailExist: true });
    } else {
      return res.json({ emailExist: false });
    }
  } catch (error) {
    next(error)
  }
})

router.get("/forgotPassword/:email", async (req, res, next) => {
  try {
    const { email } = req.params;
    const user = await checkEmail(email);

    if (!user) {
      return res.json({ status: false, message: "No user found with this email please register a new account" });
    }

    const otp = Math.floor(100 + Math.random() * 9000)

    let transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "hnhtechsolutionsemail@gmail.com",
        pass: "xownivngwllubphn"
      }
    });

    await transporter.sendMail({
      from: '"PSL Corp Wallet 👻" <hnhtechsolutionsemail@ethereal.email>', // sender address
      to: email, // list of receivers
      subject: `OTP code ${otp}`, // Subject line
      text: "OTP CODE", // plain text body
      html: `<div style={background:"red"}>
      <h1>PSL Corp Wallet</h1>
     <p>Your OTP code is ${otp}</p>
    </div>`, // html body
    });

    const updatedUser = await db.user.update({
      where: {
        id: user.id
      },
      data: {
        otp
      }
    });

    delete updatedUser.password

    return res.json({ status: true, message: "Otp send successfully.", user: updatedUser });
  } catch (error) {
    next(error)
  }
})

router.post("/changePassword", async (req, res, next) => {
  try {
    const { email, password, confirmPassword, otp } = req.body;
    const user = await checkEmail(email);

    if (!user) {
      return res.json({ status: false, message: "No user found with this email please register a new account" });
    }

    if (!email || !password || !confirmPassword || !otp) {
      return res.json({ status: false, message: "email, password, confirmPassword, otp is required" })
    }

    if (user.otp != otp) {
      return res.json({ status: false, message: "OTP not matched" })
    }

    if (password !== confirmPassword) {
      return res.json({ status: false, message: "password not matched with the confirmPassword" })
    }

    const newPass = bcrypt.hashSync(password, 12);

    const updatedUser = await db.user.update({
      where: {
        id: user.id
      },
      data: {
        password: newPass
      }
    })

    delete updatedUser.password

    return res.json({ status: true, message: "password change successfully.", user: updatedUser });
  } catch (error) {
    next(error)
  }
})

module.exports = router;
