import { AccountBalanceQuery, AccountId, Client, PrivateKey } from "@hashgraph/sdk";
import { accounts } from "./config";

export function GetAccount(accountIndex: number): {accountId: AccountId, privateKey: PrivateKey} {
  const acc = accounts[accountIndex];
  const account: AccountId = AccountId.fromString(acc.id);
  const privKey: PrivateKey = PrivateKey.fromStringED25519(acc.privateKey);
  return {accountId: account, privateKey: privKey};

}
export async function CheckBalance(client: Client, accountId: AccountId): Promise<number> {
  const query = new AccountBalanceQuery().setAccountId(accountId);
  const balance = await query.execute(client)
  return balance.hbars.toBigNumber().toNumber();
}
export async function SignAndExecuteTransaction(client: Client, transaction: any, privateKey: PrivateKey) {
  //Sign the transaction with the private key
  const signedTx = await transaction.sign(privateKey);
  
  // submit to a Hedera network
  const txResponse = await signedTx.execute(client);

  //Request the receipt of the transaction
  const receipt = await txResponse.getReceipt(client);
  
  return receipt;
}
