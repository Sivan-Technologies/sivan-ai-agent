/** Presentation hints only. The payment service authenticates and authorizes
 * each action against the current agreement; notification data cannot authorize it.
 */
export function ngnConfirmationActions(status:string,isBuyer:boolean):string[] {
  switch(status){
    case 'DRAFT_PENDING_SELLER_KYC':return isBuyer?['fund','cancel']:['accept','cancel'];
    case 'PENDING_PAYMENT':return isBuyer?['fund','cancel']:['cancel'];
    case 'FUNDED_PENDING_ACCEPTANCE':return isBuyer?['cancel']:['accept','cancel'];
    case 'FUNDED':return isBuyer?['cancel']:['start','cancel'];
    case 'IN_DELIVERY':return isBuyer?[]:['deliver'];
    case 'DELIVERED':return isBuyer?['release','dispute']:['dispute'];
    default:return [];
  }
}
