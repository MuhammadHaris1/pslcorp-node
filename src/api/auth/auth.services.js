const { db } = require('../../utils/db');
const { hashToken } = require('../../utils/hashToken');

function addRefreshTokenToWhitelist({ jti, refreshToken, userId }) {
  return db.refreshToken.create({
    data: {
      id: jti,
      hashedToken: hashToken(refreshToken),
      userId
    },
  });
}

function findRefreshTokenById(id) {
  return db.refreshToken.findUnique({
    where: {
      id,
    },
  });
}

function deleteRefreshToken(id) {
  return db.refreshToken.update({
    where: {
      id,
    },
    data: {
      revoked: true
    }
  });
}

function revokeTokens(userId) {
  return db.refreshToken.updateMany({
    where: {
      userId
    },
    data: {
      revoked: true
    }
  });
}

function checkEmail(email) {
  return db.user.findFirst({
    where: {
      email
    }
  })
}

module.exports = {
  addRefreshTokenToWhitelist,
  findRefreshTokenById,
  deleteRefreshToken,
  revokeTokens,
  checkEmail
};
