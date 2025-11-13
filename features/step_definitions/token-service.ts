import { Before, Given, ITestCaseHookParameter, setDefaultTimeout, Then, When } from "@cucumber/cucumber";
import { accounts } from "../../src/config";
import { AccountBalanceQuery, AccountId, AddressBookQuery, Client, Hbar, PrivateKey, ReceiptStatusError, Status, TokenAssociateTransaction, TokenCreateTransaction, TokenId, TokenInfo, TokenInfoQuery, TokenMintTransaction, TokenSupplyType, TransactionId, TransferTransaction } from "@hashgraph/sdk";
import assert from "node:assert";
import { GetAccount, CheckBalance, SignAndExecuteTransaction } from "../../src/common-helper";
import { Sign } from "node:crypto";
const client = Client.forTestnet()

let treasuryPrivateKey: PrivateKey;
let treasuryAccountId: AccountId;
let firstPrivKey: PrivateKey;
let firstAccountId: AccountId;
let secondPrivKey: PrivateKey;
let secondAccountId: AccountId;
let thirdPrivKey: PrivateKey;
let thirdAccountId: AccountId;
let fourthPrivKey: PrivateKey;
let fourthAccountId: AccountId;
let tokenId: TokenId;
let tokenInfo: TokenInfo;
let usedAccounts = new Set<number>();

Before(async function (this: any, testCase: ITestCaseHookParameter) {
 
  // reset per-scenario context
  usedAccounts = new Set<number>();
});

// increase timeout for slow Hedera calls
setDefaultTimeout(60 * 1000);

// Function to find an available account with sufficient balance
async function findAvailableAccount(expectedBalance: number): Promise<{accountId: AccountId, privateKey: PrivateKey}> {
  for (let i = 0; i < accounts.length; i++) {
      if (usedAccounts.has(i)) 
        continue;
      else {
        const accData = GetAccount(i);
        client.setOperator(accData.accountId, accData.privateKey);
        const checkBalance = await CheckBalance(client, accData.accountId);
        if(checkBalance > expectedBalance)
        {
          usedAccounts.add(i);
          return {accountId: accData.accountId, privateKey: accData.privateKey};
        }
      }
    }
  throw new Error("No account with sufficient balance found");
  }

// Function to verify and adjust token balance for an account
async function verifyTokenBalance(accountId: AccountId, privkey: PrivateKey, tokenId: TokenId, expectedTokens: number) {
  const query = new AccountBalanceQuery().setAccountId(accountId);
  const balance = await query.execute(client);
  // Check if the token is associated
  if(balance.tokens?.get(tokenId) == undefined) {
    console.log(`Associating token ${tokenId.toString()} with account ${accountId.toString()}`);
    const associateTransaction = new TokenAssociateTransaction()
    .setAccountId(accountId)
    .setTokenIds([tokenId])
    .freezeWith(client);

    const receipt = await SignAndExecuteTransaction(client, associateTransaction, privkey);
    const transactionStatus = receipt.status;
    console.log("The token association transaction consensus status " +transactionStatus.toString());
  }

  const existingBalance = balance.tokens?.get(tokenId)?.toNumber() ?? 0;
  console.log(`Account ${accountId.toString()} has existing balance: ${existingBalance}, expected balance: ${expectedTokens}`);

  // Only transfer if actual balance is lower than expected
  const tokensToTransfer = expectedTokens - existingBalance;

  if(tokensToTransfer>0){  
    console.log(`Transferring ${tokensToTransfer} tokens to account ${accountId.toString()}`);
    const transferTransaction = new TransferTransaction()
        .addTokenTransfer(tokenId, treasuryAccountId, -tokensToTransfer)
        .addTokenTransfer(tokenId, accountId, tokensToTransfer)
        .freezeWith(client);

    const receipt = await SignAndExecuteTransaction(client, transferTransaction, treasuryPrivateKey);
    //Obtain the transaction consensus status
    const transactionStatus = receipt.status;
     console.log("The transaction consensus status " +transactionStatus.toString());
    }
  //Sign with the client operator private key and submit to a Hedera network
  const tokenBalance = await query.execute(client);

  const actualBalance = tokenBalance.tokens 
    ? tokenBalance.tokens.get(tokenId)?.toNumber() 
    : null;

    assert.strictEqual(actualBalance, expectedTokens)
} 

// Function to create a token
async function CreateToken(treasuryAccountId: AccountId, treasuryPrivateKey: PrivateKey, decimalsValue: number, initialSupply: number | null, maxSupply: number | null): Promise<TokenId> {
  //Create the transaction and freeze for manual signing
    const tx = new TokenCreateTransaction()
        .setTokenName("Test Token")
        .setTokenSymbol("HTT")
        .setDecimals(decimalsValue) 
        .setTreasuryAccountId(treasuryAccountId)
        .setAdminKey(treasuryPrivateKey.publicKey)
        .setSupplyKey(treasuryPrivateKey.publicKey)
        .setMaxTransactionFee(new Hbar(30)) //Change the default max transaction fee
    if(initialSupply !== null) {
      tx.setInitialSupply(initialSupply);
    }
    if(maxSupply !== null) {
      tx.setMaxSupply(maxSupply);
      tx.setSupplyType(TokenSupplyType.Finite);
    }
    tx.freezeWith(client);
    const receipt = await SignAndExecuteTransaction(client, tx, treasuryPrivateKey);
    //Get the token ID from the receipt
    return receipt.tokenId as TokenId;     
}

Given(/^A Hedera account with more than (\d+) hbar$/, async function (expectedBalance: number) {
  const accountData = await findAvailableAccount(expectedBalance);
  firstAccountId = accountData.accountId;
  firstPrivKey = accountData.privateKey;
  console.log("Using account ID: " + firstAccountId.toString());
});

When(/^I create a token named Test Token \(HTT\)$/, async function () {
  //Create the transaction and freeze for manual signing
   tokenId = await CreateToken(firstAccountId, firstPrivKey, 2, null, null);

   console.log("The new token ID is " + tokenId);
   const query = new TokenInfoQuery()
      .setTokenId(tokenId);
    tokenInfo = (await query.execute(client));
});

Then(/^The token has the name "([^"]*)"$/, async function (tokenName : string) {

    assert.strictEqual(tokenName, tokenInfo.name);

});

Then(/^The token has the symbol "([^"]*)"$/, async function ( tokenSymbol: string) {
      assert.strictEqual(tokenSymbol, tokenInfo.symbol);
});

Then(/^The token has (\d+) decimals$/, async function (decimals: number) {
   assert.strictEqual(decimals, tokenInfo.decimals);
});

Then(/^The token is owned by the account$/, async function () {
  assert.strictEqual(firstAccountId.toString(), tokenInfo.treasuryAccountId?.toString());
});

Then(/^An attempt to mint (\d+) additional tokens succeeds$/, async function (mintAmount: number) {
  const transaction = new TokenMintTransaction()
     .setTokenId(tokenId)
     .setAmount(mintAmount)
     .freezeWith(client);

  const receipt = await SignAndExecuteTransaction(client, transaction, firstPrivKey);
      
  //Get the transaction consensus status
  const transactionStatus = receipt.status;

  console.log("The transaction consensus status " +transactionStatus.toString());
  assert.ok(transactionStatus.toString() === "SUCCESS");

});
When(/^I create a fixed supply token named Test Token \(HTT\) with (\d+) tokens$/, async function (maxSupply: number) {
   
  tokenId = await CreateToken(firstAccountId, firstPrivKey, 2, maxSupply, maxSupply);

  console.log("The new token ID is " + tokenId);
  const query = new TokenInfoQuery()
    .setTokenId(tokenId);
  tokenInfo = (await query.execute(client));

});
Then(/^The total supply of the token is (\d+)$/, async function (totalSupply: number) {
  assert.equal(totalSupply, tokenInfo.maxSupply);

});
Then(/^An attempt to mint tokens fails$/, async function () {
  let transactionStatus = "";
   try{
    const transaction = new TokenMintTransaction()
      .setTokenId(tokenId)
      .setAmount(100)
      .freezeWith(client);

    const receipt = await SignAndExecuteTransaction(client, transaction, firstPrivKey);
    transactionStatus = receipt.status.toString();
    console.log("The transaction consensus status " +transactionStatus.toString());
  }
  catch(error){
     if (error instanceof ReceiptStatusError) {
      console.log("Error message: " + error.status.toString());
      console.log("error status code: " + error.status._code);
      transactionStatus = error.status.toString();
     }
     else
      {
        console.log("Unexpected error: " + error);
      }
  }
  
  assert.strictEqual(transactionStatus, "TOKEN_MAX_SUPPLY_REACHED");

});
Given(/^A first hedera account with more than (\d+) hbar$/, async function (expectedBalance) {
  const accountData = await findAvailableAccount(expectedBalance);
  firstAccountId = accountData.accountId;
  firstPrivKey = accountData.privateKey;
  console.log("Using account ID: " + firstAccountId.toString());
});
Given(/^A second Hedera account$/, async function () {
   for (let i = 0; i < accounts.length; i++) {
      if (usedAccounts.has(i)) 
        continue;
      else {
        const accData = GetAccount(i);
        secondAccountId = accData.accountId;
        secondPrivKey = accData.privateKey;
        usedAccounts.add(i);
        break;
      }
    }

});
Given(/^A token named Test Token \(HTT\) with (\d+) tokens$/, async function (totalSupply: number) {
    const accountData = await findAvailableAccount(100);
    treasuryAccountId = accountData.accountId;
    treasuryPrivateKey = accountData.privateKey;
    console.log("Using treasury account ID: " + treasuryAccountId.toString());
    client.setOperator(treasuryAccountId, treasuryPrivateKey);
    tokenId = await CreateToken(treasuryAccountId, treasuryPrivateKey, 2, totalSupply, totalSupply);

    console.log("The new token ID is " + tokenId);
    const query = new TokenInfoQuery()
      .setTokenId(tokenId);
    tokenInfo = (await query.execute(client));
    assert.equal(totalSupply, tokenInfo.maxSupply);
});
Given(/^The first account holds (\d+) HTT tokens$/, async function (expectedBalance: number) {
    await verifyTokenBalance(firstAccountId, firstPrivKey, tokenId, expectedBalance);
});
Given(/^The second account holds (\d+) HTT tokens$/, async function (expectedBalance: number) {
     await verifyTokenBalance(secondAccountId, secondPrivKey, tokenId, expectedBalance);
});
When(/^The first account creates a transaction to transfer (\d+) HTT tokens to the second account$/, async function (transferAmount: number) {
    //Create the transfer transaction
  
  const transaction = new TransferTransaction()
      .addTokenTransfer(tokenId, firstAccountId, -transferAmount)
      .addTokenTransfer(tokenId, secondAccountId, transferAmount)
      .freezeWith(client);

  //Sign with the sender account private key
  this.signTx = await transaction.sign(firstPrivKey);

  //Sign with the client operator private key and submit to a Hedera network
  
});
When(/^The first account submits the transaction$/, async function () {
  
  this.initialBalance = await CheckBalance(client, firstAccountId);
  const txResponse = await this.signTx.execute(client);

  //Request the receipt of the transaction
  const receipt = await txResponse.getReceipt(client);

  //Obtain the transaction consensus status
  const transactionStatus = receipt.status;
  console.log("The transaction consensus status " +transactionStatus.toString());
});
When(/^The second account creates a transaction to transfer (\d+) HTT tokens to the first account$/, async function (transferAmount: number) {
    client.setOperator(firstAccountId, firstPrivKey);
  const transaction = new TransferTransaction()
      .addTokenTransfer(tokenId, secondAccountId, -transferAmount)
      .addTokenTransfer(tokenId, firstAccountId, transferAmount)
      .freezeWith(client);

  //Sign with the sender account private key
  this.signTx = await transaction.sign(secondPrivKey);
});
Then(/^The first account has paid for the transaction fee$/, async function () {
      const finalBalance = await CheckBalance(client, firstAccountId);
      console.log("Transaction Fee Paid: " + (this.initialBalance - finalBalance));
      assert.ok(this.initialBalance - finalBalance > 0);
});
Given(/^A first hedera account with more than (\d+) hbar and (\d+) HTT tokens$/, async function (hbarBalance: number, tokenBalance: number) {
  const accountData = await findAvailableAccount(hbarBalance);
  firstAccountId = accountData.accountId;
  firstPrivKey = accountData.privateKey;
  console.log("Using account ID: " + firstAccountId.toString());
  await verifyTokenBalance(firstAccountId, firstPrivKey, tokenId, tokenBalance);
});
Given(/^A second Hedera account with (\d+) hbar and (\d+) HTT tokens$/, async function (hbarBalance: number, tokenBalance: number) {
  const accountData = await findAvailableAccount(hbarBalance);
  secondAccountId = accountData.accountId;
  secondPrivKey = accountData.privateKey;
  await verifyTokenBalance(secondAccountId, secondPrivKey, tokenId, tokenBalance);
});
Given(/^A third Hedera account with (\d+) hbar and (\d+) HTT tokens$/, async function (hbarBalance: number, tokenBalance: number) {
  const accountData = await findAvailableAccount(hbarBalance);
  thirdAccountId = accountData.accountId;
  thirdPrivKey = accountData.privateKey;
  await verifyTokenBalance(thirdAccountId, thirdPrivKey, tokenId, tokenBalance);
});
Given(/^A fourth Hedera account with (\d+) hbar and (\d+) HTT tokens$/, async function (hbarBalance: number, tokenBalance: number) {
  const accountData = await findAvailableAccount(hbarBalance);
  fourthAccountId = accountData.accountId;
  fourthPrivKey = accountData.privateKey;
  await verifyTokenBalance(fourthAccountId, fourthPrivKey, tokenId, tokenBalance);
});
When(/^A transaction is created to transfer (\d+) HTT tokens out of the first and second account and (\d+) HTT tokens into the third account and (\d+) HTT tokens into the fourth account$/, async function (TotalTransferFrom: number, thirdAccountTokens: number, fourthAccountTokens: number) {
  const transaction = new TransferTransaction()
      .addTokenTransfer(tokenId, firstAccountId, -TotalTransferFrom)
      .addTokenTransfer(tokenId, secondAccountId, -TotalTransferFrom)
      .addTokenTransfer(tokenId, thirdAccountId, thirdAccountTokens)
      .addTokenTransfer(tokenId, fourthAccountId, fourthAccountTokens)
      .freezeWith(client);
  this.signTx = await transaction.sign(firstPrivKey);
  this.signTx = await this.signTx.sign(secondPrivKey);

});
Then(/^The third account holds (\d+) HTT tokens$/, async function (expectedTokens: number) {
  await verifyTokenBalance(thirdAccountId, thirdPrivKey, tokenId, expectedTokens);
});
Then(/^The fourth account holds (\d+) HTT tokens$/, async function (expectedTokens: number) {
  await verifyTokenBalance(fourthAccountId, fourthPrivKey, tokenId, expectedTokens);
});
