import { SyncDb } from "../../src/wal";
import { User } from "./user";
import { NotificationType } from "../../src/mixins/observable";
import {
	ClientQueryType,
	ClientQuery,
	ClientActionMessage,
	ActionName,
	Notification,
	WalletResponse,
	ClientResponse,
	ResponseSink,
	ChannelStates,
	NetworkContext
} from "../../src/types";

export class TestWallet implements ResponseSink {
	users: Map<string, User>;
	address?: string;
	private requests: Map<string, Function>;
	private responseListener?: Function;
	private messageListener?: Function;

	constructor() {
		this.users = new Map<string, User>();
		this.requests = new Map<string, Function>();
	}

	setUser(
		address: string,
		privateKey: string,
		db?: SyncDb,
		states?: ChannelStates,
		networkContext?: NetworkContext
	) {
		this.address = address;

		if (!this.users.has(address)) {
			this.users.set(
				address,
				new User(this, address, privateKey, db, states, networkContext)
			);
		}
	}

	get currentUser(): User {
		if (!this.address) {
			throw Error("could not find current user without address");
		}

		return this.users.get(this.address)!;
	}

	/**
	 * The test will call this when it wants to start a protocol.
	 * Returns a promise that resolves with a Response object when
	 * the protocol has completed execution.
	 */
	async runProtocol(msg: ClientActionMessage): Promise<WalletResponse> {
		let promise = new Promise<WalletResponse>((resolve, reject) => {
			this.requests[msg.requestId] = resolve;
		});
		let response = this.currentUser.vm.receive(msg);
		return promise;
	}

	/**
	 * Resolves the registered promise so the test can continue.
	 */
	sendResponse(res: WalletResponse | Notification) {
		if ("requestId" in res && this.requests[res.requestId] !== undefined) {
			let promise = this.requests[res.requestId];
			delete this.requests[res.requestId];
			promise(res);
		} else {
			this.sendMessageToClient(res);
		}
	}

	/**
	 * Called When a peer wants to send an io messge to this wallet.
	 */
	receiveMessageFromPeer(incoming: ClientActionMessage) {
		console.log(
			"Receive from peer: " +
				incoming.fromAddress +
				", by: " +
				incoming.toAddress,
			incoming.action,
			incoming.seq
		);
		this.currentUser.io.receiveMessageFromPeer(incoming);
	}

	// TODO figure out which client to send the response to
	sendResponseToClient(response: ClientResponse) {
		if (this.responseListener) {
			this.responseListener(response);
		}
	}

	sendMessageToClient(msg: ClientResponse | Notification) {
		if (this.responseListener) {
			this.responseListener(msg);
		}
	}

	// TODO make responseListener a map/array
	onResponse(callback: Function) {
		this.responseListener = callback;
	}

	// TODO figure out which client to send the response to
	// TODO refactor to clarify difference with sendMessageToClient
	sendIoMessageToClient(message: ClientActionMessage) {
		if (this.messageListener) {
			this.messageListener(message);
		}
	}

	// TODO make messageListener a map/array
	onMessage(callback: Function) {
		this.messageListener = callback;
	}

	handleFreeBalanceQuery(query: ClientQuery) {
		if (typeof query.multisigAddress === "string") {
			let freeBalance = this.currentUser.vm.cfState.freeBalanceFromMultisigAddress(
				query.multisigAddress
			);
			let response = {
				requestId: query.requestId,
				data: {
					freeBalance: freeBalance
				}
			};

			this.sendResponseToClient(response);
		}
	}

	sendNotification(type: NotificationType, data: object) {
		let message: Notification = {
			type: "notification",
			notificationType: type,
			data: data
		};

		this.sendResponse(message);
	}

	addObserver(message: ClientActionMessage) {
		this.currentUser.addObserver(message);
	}

	removeObserver(message: ClientActionMessage) {
		this.currentUser.removeObserver(message);
	}

	setClientToHandleIO() {
		this.currentUser.io.setClientToHandleIO();
	}

	handleStateChannelQuery(query: ClientQuery) {
		if (typeof query.multisigAddress === "string") {
			let stateChannel = this.currentUser.vm.cfState.stateChannelFromMultisigAddress(
				query.multisigAddress
			);
			let response = {
				requestId: query.requestId,
				data: {
					stateChannel: stateChannel
				}
			};

			this.sendResponseToClient(response);
		}
	}

	handleUserQuery(query: ClientQuery) {
		let response = {
			requestId: query.requestId,
			data: {
				userAddress: this.address
			}
		};

		this.sendResponseToClient(response);
	}

	async receiveMessageFromClient(incoming: ClientActionMessage | ClientQuery) {
		if ("query" in incoming) {
			switch (incoming.query) {
				case ClientQueryType.FreeBalance:
					this.handleFreeBalanceQuery(incoming);
					break;
				case ClientQueryType.StateChannel:
					this.handleStateChannelQuery(incoming);
					break;
				case ClientQueryType.User:
					this.handleUserQuery(incoming);
					break;
			}
		} else if (incoming.action) {
			switch (incoming.action) {
				case ActionName.ADD_OBSERVER: {
					this.addObserver(incoming);
					break;
				}
				case ActionName.REMOVE_OBSERVER: {
					this.removeObserver(incoming);
					break;
				}
				case ActionName.REGISTER_IO: {
					this.setClientToHandleIO();
					break;
				}
				case ActionName.RECEIVE_IO: {
					this.currentUser.io.receiveMessageFromPeer(incoming.data);
					break;
				}
				default: {
					await this.runProtocol(incoming);
					break;
				}
			}
			console.log("incoming message", incoming);
			this.sendResponseToClient(incoming);
		}
	}
}
