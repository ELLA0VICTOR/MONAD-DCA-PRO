const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  // 1. Deploy AllowedMethodsEnforcer
  const Methods = await ethers.getContractFactory("AllowedMethodsEnforcer");
  const methods = await Methods.deploy();
  await methods.waitForDeployment();
  console.log("AllowedMethodsEnforcer:", methods.target);

  // 2. Deploy AllowedTargetsEnforcer
  const Targets = await ethers.getContractFactory("AllowedTargetsEnforcer");
  const targets = await Targets.deploy();
  await targets.waitForDeployment();
  console.log("AllowedTargetsEnforcer:", targets.target);

  // 3. Deploy ERC20TransferAmountEnforcer
  const Transfer = await ethers.getContractFactory("ERC20TransferAmountEnforcer");
  const transfer = await Transfer.deploy();
  await transfer.waitForDeployment();
  console.log("ERC20TransferAmountEnforcer:", transfer.target);

  // 4. Deploy TimestampEnforcer
  const Timestamp = await ethers.getContractFactory("TimestampEnforcer");
  const timestamp = await Timestamp.deploy();
  await timestamp.waitForDeployment();
  console.log("TimestampEnforcer:", timestamp.target);

  // 5. Deploy DelegationManager (constructor requires _owner param)
  const Manager = await ethers.getContractFactory("DelegationManager");
  const manager = await Manager.deploy(deployer.address);
  await manager.waitForDeployment();
  console.log("DelegationManager:", manager.target);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
